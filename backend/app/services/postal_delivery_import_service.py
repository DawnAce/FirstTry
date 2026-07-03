"""邮局读者明细导入 —— 解析结果 → ``PostalDelivery`` 投递记录（preview / commit）。

**每行 = 一条投递记录，不是订单**（重构后：邮局＝投递方式）。``(year, delivery_no)`` 去重
（delivery_no = 编号去前导零）。产品认不出**留原文**（邮局是纯投递、不强求刊物枚举）。读者明细
本身没有平台订单号 → ``order_id`` 一律留空，将来补上订单号再挂真实订单。

复用 ``postal_order_import_parser`` 解析 + ``order_import_cache`` 会话握手（预览→提交幂等）。
投递单位「有原文就匹配 Partner、没有就留空」——不推断（用户明确）。汇款/赠阅关联等杂项暂存 notes。
"""

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Partner, PartnerType, PostalDelivery
from app.models.postal_delivery import PostalDeliverySourceType
from app.order_import_cache import pop_order_import_session, save_order_import_session
from app.services import postal_common as pc
from app.services.postal_order_import_parser import (
    ParsedPostalRow,
    is_postal_reader_export,
    parse_postal_readers,
)


@dataclass
class PostalPreviewRow:
    delivery_no: str
    year: Optional[int]
    name: str
    amount: Decimal
    decision: str  # import | duplicate | unresolved
    coverage_label: str = ""
    distribution_unit: str = ""
    reason: Optional[str] = None
    warnings: List[str] = field(default_factory=list)
    data: Optional[dict] = field(default=None, repr=False)


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

def _parse_mmdd(year: int, mmdd: str) -> date:
    s = "".join(ch for ch in (mmdd or "") if ch.isdigit()).zfill(4)
    return date(year, int(s[:2]), int(s[2:]))


def _to_amount(raw: str) -> Decimal:
    try:
        return Decimal(str(raw).strip() or "0")
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _extras_notes(pr: ParsedPostalRow) -> Optional[str]:
    bits = []
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
        (y, n) for y, n in db.query(PostalDelivery.year, PostalDelivery.delivery_no).all()
    }
    dist_map = _distribution_map(db)
    seen_in_batch: set = set()

    out: List[PostalPreviewRow] = []
    for pr in rows:
        year = pc.parse_year(pr.year_raw)
        if year is None:
            out.append(PostalPreviewRow("", None, pr.name, Decimal("0"),
                                        "unresolved", reason=f"年度无法解析：「{pr.year_raw}」"))
            continue

        delivery_no = pc.norm_no(pr.external_no_raw)
        if delivery_no is None:
            out.append(PostalPreviewRow("", year, pr.name, Decimal("0"),
                                        "unresolved", reason=f"编号无法解析：「{pr.external_no_raw}」"))
            continue

        key = (year, delivery_no)
        if key in existing or key in seen_in_batch:
            out.append(PostalPreviewRow(delivery_no, year, pr.name, Decimal("0"),
                                        "duplicate", reason="编号已存在，跳过"))
            continue

        try:
            cov_start = _parse_mmdd(year, pr.start_mmdd)
            cov_end = _parse_mmdd(year, pr.end_mmdd)
        except (ValueError, TypeError):
            out.append(PostalPreviewRow(delivery_no, year, pr.name, Decimal("0"), "unresolved",
                                        reason=f"起止月无法解析：「{pr.start_mmdd}/{pr.end_mmdd}」"))
            continue
        if cov_end < cov_start:
            out.append(PostalPreviewRow(delivery_no, year, pr.name, Decimal("0"), "unresolved",
                                        reason=f"止月日早于起月日：「{pr.start_mmdd}/{pr.end_mmdd}」"))
            continue

        warnings: List[str] = []
        copies = pc.to_int_or_none(pr.copies_raw)
        if copies is None:
            copies = 1
        if copies < 1:
            out.append(PostalPreviewRow(delivery_no, year, pr.name, _to_amount(pr.amount_raw),
                                        "unresolved", reason=f"份数非法：「{pr.copies_raw}」"))
            continue
        amount = _to_amount(pr.amount_raw)
        if amount > Decimal("99999999.99"):
            out.append(PostalPreviewRow(delivery_no, year, pr.name, amount, "unresolved",
                                        reason=f"金额超出上限 99999999.99：「{pr.amount_raw}」"))
            continue
        if amount <= 0:
            warnings.append("金额为空/为 0")

        dist_id = None
        if pr.distribution_unit_name:
            dist_id = dist_map.get(pr.distribution_unit_name)
            if dist_id is None:
                warnings.append(f"投递单位未匹配主数据：「{pr.distribution_unit_name}」→ 留空")

        remit = pc.parse_date(pr.remittance_date_raw)
        data = {
            "year": year,
            "delivery_no": delivery_no,
            # 读者明细无平台订单号 → 一律不挂订单（将来补订单号再挂）。
            "order_id": None,
            "external_order_no": None,
            "source_type": PostalDeliverySourceType.historical_import.value,
            "recipient_name": pr.name or "(未填写)",
            "recipient_phone": pr.phone or None,
            "recipient_province": pr.province or None,
            "recipient_city": pr.city or None,
            "recipient_district": pr.district or None,
            "recipient_address": pc.compose_address(pr.province, pr.city, pr.district, pr.detail_address) or "(未填写)",
            "recipient_postal_code": pr.postal_code or None,
            # 产品认不出留原文（邮局是纯投递，不强求刊物枚举）。
            "product": pr.product_name or None,
            "copies": copies,
            "amount": str(amount),  # 空/0 记 0.00（与预览显示一致，不用 NULL）
            "coverage_start_date": cov_start.isoformat(),
            "coverage_end_date": cov_end.isoformat(),
            "source_channel": pr.channel or None,
            "distribution_unit_id": dist_id,
            "salesperson": pr.salesperson or None,
            "remittance_name": pr.remittance_name or None,
            "remittance_date": remit.isoformat() if remit else None,
            "notes": _extras_notes(pr),
        }
        seen_in_batch.add(key)
        out.append(PostalPreviewRow(
            delivery_no=delivery_no,
            year=year,
            name=pr.name,
            amount=amount,
            decision="import",
            coverage_label=f"{cov_start:%Y-%m-%d}~{cov_end:%Y-%m-%d}",
            distribution_unit=pr.distribution_unit_name,
            warnings=warnings,
            data=data,
        ))

    return PostalImportPreview(out)


def _serialize_row(r: PostalPreviewRow) -> dict:
    return {
        "delivery_no": r.delivery_no,
        "year": r.year,
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

    commit_rows = [{"data": r.data} for r in preview.by_decision("import")]
    session_id = save_order_import_session({"mode": "postal_delivery", "rows": commit_rows})

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

    existing = {
        (y, n) for y, n in db.query(PostalDelivery.year, PostalDelivery.delivery_no).all()
    }
    created = 0
    skipped = 0
    delivery_ids: List[int] = []
    for r in payload["rows"]:
        d = dict(r["data"])
        key = (d["year"], d["delivery_no"])
        if key in existing:
            skipped += 1
            continue
        existing.add(key)
        for f in ("coverage_start_date", "coverage_end_date", "remittance_date"):
            d[f] = date.fromisoformat(d[f]) if d[f] else None
        d["amount"] = Decimal(d["amount"]) if d["amount"] else None
        d["source_type"] = PostalDeliverySourceType(d["source_type"])
        if operator_id:
            d["created_by"] = operator_id
        rec = PostalDelivery(**d)
        db.add(rec)
        db.flush()
        delivery_ids.append(rec.id)
        created += 1

    db.commit()
    return {
        "created": created,
        "delivery_ids": delivery_ids,
        "skipped_duplicates": skipped,
    }
