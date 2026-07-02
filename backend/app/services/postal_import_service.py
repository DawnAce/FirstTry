"""邮局读者明细导入 —— 解析结果 → post_office 订单（preview / commit）。

每行 → 一张订单：``Order``(渠道→source_platform、付款方=姓名) + ``OrderItem``
(中国经营报=cbj、覆盖期取自 年度+起/止月、delivery=post_office、份数/金额) + ``FulfillmentTarget``
(收报人、shipping_channel=post_office、投递单位→Partner)。编号加年份前缀作 external_order_no 去重。
提交复用 ``order_code_service.allocate_order_codes`` + ``order_service.create_imported_order`` 原子建单。

投递单位「有原文就匹配 Partner、没有就留空」——不自动推断（用户明确）。汇款/赠阅关联等暂存 notes
（原样保留、不丢），P2–P4 再给结构化归宿。
"""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Order, Partner, PartnerType
from app.models.fulfillment_target import ShippingChannel
from app.models.order_item import (
    BillingType,
    DeliveryMethod,
    FulfillmentType,
    Publication,
    PublicationFormat,
)
from app.order_import_cache import pop_order_import_session, save_order_import_session
from app.schemas.order import FulfillmentTargetIn, OrderCreate, OrderItemIn
from app.services.order_code_service import allocate_order_codes
from app.services.order_service import create_imported_order
from app.services.postal_order_import_parser import (
    ParsedPostalRow,
    is_postal_reader_export,
    parse_postal_readers,
)

_SOURCE_STORE = "邮局集订分送"


@dataclass
class PostalPreviewRow:
    external_order_no: str
    name: str
    amount: Decimal
    decision: str  # import | duplicate | unresolved
    coverage_label: str = ""
    distribution_unit: str = ""
    reason: Optional[str] = None
    warnings: List[str] = field(default_factory=list)
    order_create: Optional[OrderCreate] = None


@dataclass
class PostalImportPreview:
    rows: List[PostalPreviewRow]

    @property
    def counts(self) -> dict:
        c = {"total": len(self.rows), "import": 0, "duplicate": 0, "unresolved": 0}
        for r in self.rows:
            c[r.decision] = c.get(r.decision, 0) + 1
        return c

    def by_decision(self, decision: str) -> List[PostalPreviewRow]:
        return [r for r in self.rows if r.decision == decision]


# --- 字段映射 helpers -------------------------------------------------------

def _publication_for(name: str) -> Optional[Publication]:
    n = name or ""
    if "中国经营报" in n:
        return Publication.cbj
    if "商学院" in n:
        return Publication.business_school
    return None


def _parse_year(raw: str) -> Optional[int]:
    digits = "".join(ch for ch in (raw or "") if ch.isdigit())
    if len(digits) >= 4:
        return int(digits[:4])
    return None


def _parse_mmdd(year: int, mmdd: str) -> date:
    s = "".join(ch for ch in (mmdd or "") if ch.isdigit()).zfill(4)
    return date(year, int(s[:2]), int(s[2:]))


def _to_int(raw: str, default: int = 1) -> int:
    try:
        return int(float(raw))
    except (ValueError, TypeError):
        return default


def _to_amount(raw: str) -> Decimal:
    try:
        return Decimal(str(raw).strip() or "0")
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _compose_address(pr: ParsedPostalRow) -> str:
    detail = (pr.detail_address or "").strip()
    prefix = f"{pr.province}{pr.city}{pr.district}"
    if not detail:
        return prefix or "(未填写)"
    # 详细地址常已含省/市，避免重复前缀。
    if pr.province and pr.province[:2] and pr.province[:2] in detail[:8]:
        return detail
    return f"{prefix}{detail}" if prefix else detail


def _extras_notes(pr: ParsedPostalRow) -> Optional[str]:
    bits = []
    if pr.remittance_name:
        bits.append(f"汇款名称:{pr.remittance_name}")
    if pr.remittance_date_raw:
        bits.append(f"汇款日期:{pr.remittance_date_raw}")
    if pr.salesperson:
        bits.append(f"赠阅/关联:{pr.salesperson}")
    if pr.region:
        bits.append(f"地区:{pr.region}")
    if pr.notes:
        bits.append(f"备注:{pr.notes}")
    return "；".join(bits) if bits else None


def _distribution_map(db: Session) -> dict:
    rows = (
        db.query(Partner.name, Partner.id)
        .filter(Partner.partner_type == PartnerType.distribution)
        .all()
    )
    return {name: pid for name, pid in rows}


# --- preview ----------------------------------------------------------------

def build_postal_preview(
    db: Session, rows: List[ParsedPostalRow]
) -> PostalImportPreview:
    existing = {
        e
        for (e,) in db.query(Order.external_order_no)
        .filter(Order.external_order_no.isnot(None))
        .all()
    }
    dist_map = _distribution_map(db)
    seen_in_batch: set = set()

    out: List[PostalPreviewRow] = []
    for pr in rows:
        year = _parse_year(pr.year_raw)
        if year is None:
            out.append(PostalPreviewRow(pr.external_no_raw, pr.name, Decimal("0"),
                                        "unresolved", reason=f"年度无法解析：「{pr.year_raw}」"))
            continue

        external = f"{year}-{pr.external_no_raw}"
        if external in existing or external in seen_in_batch:
            out.append(PostalPreviewRow(external, pr.name, Decimal("0"),
                                        "duplicate", reason="订单号已存在，跳过"))
            continue

        publication = _publication_for(pr.product_name)
        if publication is None:
            out.append(PostalPreviewRow(external, pr.name, Decimal("0"),
                                        "unresolved", reason=f"产品未识别：「{pr.product_name}」"))
            continue

        try:
            cov_start = _parse_mmdd(year, pr.start_mmdd)
            cov_end = _parse_mmdd(year, pr.end_mmdd)
        except (ValueError, TypeError):
            out.append(PostalPreviewRow(external, pr.name, Decimal("0"), "unresolved",
                                        reason=f"起止月无法解析：「{pr.start_mmdd}/{pr.end_mmdd}」"))
            continue
        if cov_end < cov_start:
            out.append(PostalPreviewRow(external, pr.name, Decimal("0"), "unresolved",
                                        reason=f"止月日早于起月日：「{pr.start_mmdd}/{pr.end_mmdd}」"))
            continue

        warnings: List[str] = []
        copies = _to_int(pr.copies_raw, default=1)
        if copies < 1:
            out.append(PostalPreviewRow(external, pr.name, _to_amount(pr.amount_raw),
                                        "unresolved", reason=f"份数非法：「{pr.copies_raw}」"))
            continue
        amount = _to_amount(pr.amount_raw)
        if amount <= 0:
            warnings.append("金额为空/为 0")
        unit_price = (amount / copies).quantize(Decimal("0.01"))

        dist_id = None
        if pr.distribution_unit_name:
            dist_id = dist_map.get(pr.distribution_unit_name)
            if dist_id is None:
                warnings.append(f"投递单位未匹配主数据：「{pr.distribution_unit_name}」→ 留空")

        address = _compose_address(pr)
        oc = OrderCreate(
            external_order_no=external,
            order_date=cov_start,
            source_platform=(pr.channel or None),
            source_store=_SOURCE_STORE,
            payer_name=pr.name or "(未填写)",
            payer_contact=pr.phone or None,
            total_amount=amount,
            paid_amount=amount,
            notes=_extras_notes(pr),
            items=[
                OrderItemIn(
                    publication=publication,
                    publication_format=PublicationFormat.paper,
                    fulfillment_type=FulfillmentType.subscription,
                    billing_type=BillingType.paid,
                    delivery_method=DeliveryMethod.post_office,
                    coverage_start_date=cov_start,
                    coverage_end_date=cov_end,
                    total_quantity=copies,
                    unit_price=unit_price,
                    subtotal=amount,
                    targets=[
                        FulfillmentTargetIn(
                            recipient_name=pr.name or "(未填写)",
                            recipient_phone=pr.phone or None,
                            recipient_address=address,
                            recipient_postal_code=pr.postal_code or None,
                            quantity=copies,
                            shipping_channel=ShippingChannel.post_office,
                            distribution_unit_id=dist_id,
                        )
                    ],
                )
            ],
        )
        seen_in_batch.add(external)
        out.append(PostalPreviewRow(
            external_order_no=external,
            name=pr.name,
            amount=amount,
            decision="import",
            coverage_label=f"{cov_start:%Y-%m-%d}~{cov_end:%Y-%m-%d}",
            distribution_unit=pr.distribution_unit_name,
            warnings=warnings,
            order_create=oc,
        ))

    return PostalImportPreview(out)


def _serialize_row(r: PostalPreviewRow) -> dict:
    return {
        "external_order_no": r.external_order_no,
        "name": r.name,
        "amount": str(r.amount),
        "decision": r.decision,
        "coverage_label": r.coverage_label,
        "distribution_unit": r.distribution_unit,
        "reason": r.reason,
        "warnings": r.warnings,
    }


# --- preview / commit (cached session handoff) ------------------------------

def preview_import(db: Session, file_bytes: bytes) -> Tuple[dict, str]:
    if not is_postal_reader_export(file_bytes):
        raise HTTPException(
            status_code=400,
            detail="不是邮局读者明细：未找到含「编号/姓名/起月日/投递单位」表头的工作表",
        )
    parsed = parse_postal_readers(file_bytes)
    preview = build_postal_preview(db, parsed)

    commit_rows = [
        {"order_create": r.order_create.model_dump(mode="json")}
        for r in preview.by_decision("import")
    ]
    session_id = save_order_import_session({"mode": "postal", "rows": commit_rows})

    out = {
        "session_id": session_id,
        "counts": preview.counts,
        "can_commit": preview.counts.get("import", 0) > 0,
        "rows": [_serialize_row(r) for r in preview.rows],
    }
    return out, session_id


def commit_import(db: Session, session_id: str, operator_id: Optional[int] = None) -> dict:
    payload = pop_order_import_session(session_id)
    if payload is None:
        raise HTTPException(status_code=400, detail="导入会话不存在或已过期，请重新预览")

    rows = payload["rows"]
    existing = {
        e
        for (e,) in db.query(Order.external_order_no)
        .filter(Order.external_order_no.isnot(None))
        .all()
    }
    to_create = [r for r in rows if r["order_create"]["external_order_no"] not in existing]
    skipped = len(rows) - len(to_create)

    by_year: dict[int, list] = defaultdict(list)
    for r in to_create:
        by_year[int(r["order_create"]["order_date"][:4])].append(r)
    for year, group in by_year.items():
        for r, code in zip(group, allocate_order_codes(db, year, len(group))):
            r["_code"] = code

    created = []
    for r in to_create:
        order = create_imported_order(
            db,
            OrderCreate(**r["order_create"]),
            order_code=r["_code"],
            is_historical_archive=True,
            import_source_sheet="邮局读者明细",
            operator_id=operator_id,
        )
        created.append(order)

    db.commit()
    return {
        "created": len(created),
        "order_ids": [o.id for o in created],
        "skipped_duplicates": skipped,
    }
