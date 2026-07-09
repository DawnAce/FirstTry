"""CBJ order import — resolution / preview building (Phase 3b-3, core).

Ties the parser + product resolver + status mapping + coverage rules + dedup into
a per-order decision and a ready-to-create OrderCreate payload. The preview/commit
API and session cache wrap this (next slice); commit feeds the importable rows'
OrderCreate to ``order_service.create_imported_order``.

Per order the decision is one of:
* ``import``      — resolved cleanly; ``order_create`` is the payload.
* ``skip_status`` — platform status is not a real sale (待付款 / 已取消).
* ``duplicate``   — external_order_no already in the system.
* ``unresolved``  — product not in the catalog, or missing a date → 待确认 queue.

Coverage is operator-driven per batch: ``BatchSettings`` carries the start month
(邮局/中通 separately) and a cutoff date (payment after it → next month). Historical
mode leaves coverage blank. Every row stays editable in the preview UI.
"""

import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import (
    Order,
    OrderCommercialStatus,
    OrderPaymentMethod,
    Product,
    PublicationSchedule,
)
from app.models.order_item import (
    BillingType,
    DeliveryMethod,
    FulfillmentType,
    Publication,
    PublicationFormat,
    SubscriptionTerm,
)
from app.models.product import CoverageRule
from app.order_import_cache import pop_order_import_session, save_order_import_session
from app.schemas.order import FulfillmentTargetIn, OrderCreate, OrderItemIn
from app.services.cbj_order_import_parser import (
    ParsedOrder,
    is_cbj_export,
    parse_cbj_orders,
)
from app.services.taobao_order_import_parser import (
    is_taobao_export,
    parse_taobao_orders,
)
from app.services.order_code_service import allocate_order_codes
from app.services.order_import_status_service import map_commercial_status
from app.services.issue_label import normalize_business_school_issue_label
from app.services.latest_issue_resolver import resolve_latest_issue
from app.services.order_service import create_imported_order
from app.services.product_resolver_service import (
    ResolvedItem,
    _make_item,
    resolve_product,
)

# Source-platform / store labels written onto imported orders. Kept aligned with
# the frontend OrderEditor dropdown so列表/详情显示一致。``_detect_and_parse`` picks
# the pair per uploaded file; manual orders set these via the editor.
CBJ_PLATFORM = "CBJ小程序"
TAOBAO_PLATFORM = "淘宝"
TAOBAO_STORE = "中国经营报发行部"
_SOURCE_PLATFORM = CBJ_PLATFORM  # default for build_import_preview / existing callers

_PAYMENT_MAP = {
    "微信": OrderPaymentMethod.wechat,
    "支付宝": OrderPaymentMethod.alipay,
    "银行卡": OrderPaymentMethod.bank_card,
}


@dataclass
class BatchSettings:
    mode: str = "recent"  # "recent" | "historical"
    post_office_start_month: Optional[str] = None  # "YYYY-MM"
    zto_start_month: Optional[str] = None
    cutoff_date: Optional[date] = None  # payment strictly after → next month
    # 营销活动标签（如 "2026-618"）：写到每张订单的 ``campaign``，用于追溯 + 按活动统计。
    campaign: Optional[str] = None
    # 赠品·订期延长月数（如 618 送 1 个月）：加到本批订阅明细的覆盖期末（13 个月）。
    bonus_months: int = 0
    # 赠品·赠送刊物：给本批每张"含订阅"的订单加一条免费明细（CBJ 导出无此行，按活动
    # 约定人工补全）。``gift_publication`` 为 Publication 值，``gift_note`` 为说明文案。
    gift_publication: Optional[str] = None
    gift_note: Optional[str] = None


@dataclass
class PreviewRow:
    external_order_no: str
    recipient_name: str
    paid_amount: Decimal
    status_raw: str
    commercial_status: Optional[OrderCommercialStatus]
    decision: str
    reason: Optional[str] = None
    status_unknown: bool = False
    delivery_overridden_to_zto: bool = False
    warnings: List[str] = field(default_factory=list)
    order_create: Optional[OrderCreate] = None
    # The raw product-line name that failed to resolve (for the 待确认 queue /
    # quick-add to catalog). Set only when decision == unresolved due to a miss.
    unresolved_product: Optional[str] = None


@dataclass
class ImportPreview:
    rows: List[PreviewRow]

    def by_decision(self, decision: str) -> List[PreviewRow]:
        return [r for r in self.rows if r.decision == decision]

    @property
    def counts(self) -> dict:
        c = {"total": len(self.rows), "import": 0, "skip_status": 0, "duplicate": 0, "unresolved": 0}
        for r in self.rows:
            c[r.decision] = c.get(r.decision, 0) + 1
        return c


def _payment_method(raw: str) -> Optional[OrderPaymentMethod]:
    return _PAYMENT_MAP.get((raw or "").strip())


def _add_months(d: date, months: int) -> date:
    idx = d.year * 12 + (d.month - 1) + months
    return date(idx // 12, idx % 12 + 1, 1)


def _start_month_for(settings: BatchSettings, delivery, payment_time) -> Optional[str]:
    base = (
        settings.zto_start_month
        if delivery == DeliveryMethod.zto_mf
        else settings.post_office_start_month
    )
    if not base:
        return None
    if settings.cutoff_date and payment_time and payment_time.date() > settings.cutoff_date:
        nxt = _add_months(date(int(base[:4]), int(base[5:7]), 1), 1)
        return f"{nxt.year:04d}-{nxt.month:02d}"
    return base


def _coverage_for(settings, item, coverage_rule, payment_time):
    """Default coverage for an item (editable later). Blank for historical /
    non-subscription / when no start month is configured."""
    if settings.mode == "historical":
        return None, None
    if coverage_rule != CoverageRule.term_from_month:
        return None, None
    start_month = _start_month_for(settings, item.delivery_method, payment_time)
    if not start_month:
        return None, None
    start = date(int(start_month[:4]), int(start_month[5:7]), 1)
    months = 6 if item.subscription_term == SubscriptionTerm.half_year else 12
    months += max(0, settings.bonus_months or 0)  # 活动赠送的延长月数
    return start, _add_months(start, months) - timedelta(days=1)


def _gift_item(settings: BatchSettings, po) -> OrderItemIn:
    """The campaign gift as a free, recorded order line.

    The CBJ export has no row for the gift (it's an off-platform campaign perk),
    so the operator configures it per batch and we materialize it here for full
    traceability. ``fulfillment_type=gift`` → not auto-synced to shipping and never
    counts toward expected-issue drift; the recipient mirrors the main order.
    """
    return OrderItemIn(
        publication=Publication(settings.gift_publication),
        publication_format=PublicationFormat.paper,
        fulfillment_type=FulfillmentType.gift,
        billing_type=BillingType.free_gift,
        total_quantity=1,
        unit_price=Decimal("0"),
        subtotal=Decimal("0"),
        notes=settings.gift_note,
        targets=[
            FulfillmentTargetIn(
                recipient_name=po.recipient_name or "(未填写)",
                recipient_phone=po.recipient_phone or None,
                recipient_address=po.recipient_address or "(未填写)",
                recipient_postal_code=po.recipient_postal_code,
                quantity=1,
            )
        ],
    )


def _row(po, status_map, decision, **kw) -> PreviewRow:
    return PreviewRow(
        external_order_no=po.external_order_no,
        recipient_name=po.recipient_name,
        paid_amount=po.paid_amount,
        status_raw=po.status_raw,
        commercial_status=status_map.status,
        decision=decision,
        **kw,
    )


# 忽略名单：长尾特殊品（第三方刊物如家族企业/深潜、商学院售罄案例辑、电子刊、对公大单、
# 一次性怪单）—— 不进商品库、不导入、不进待确认，导入时直接跳过。以后在此增删关键词。
_IGNORED_PRODUCT_KEYWORDS = ("家族企业", "深潜", "深度系列", "电子刊", "对公专用", "利润薄如刀片")


def _is_ignored_product(name: str) -> bool:
    return any(k in (name or "") for k in _IGNORED_PRODUCT_KEYWORDS)


def build_import_preview(
    db: Session,
    parsed_orders: List[ParsedOrder],
    settings: BatchSettings,
    source_platform: str = _SOURCE_PLATFORM,
    source_store: Optional[str] = None,
) -> ImportPreview:
    products = db.query(Product).filter(Product.active.is_(True)).all()
    schedule = db.query(PublicationSchedule).all()
    existing = {
        e
        for (e,) in db.query(Order.external_order_no)
        .filter(Order.external_order_no.isnot(None))
        .all()
    }

    rows: List[PreviewRow] = []
    for po in parsed_orders:
        sm = map_commercial_status(po.status_raw)
        if not sm.should_import:
            rows.append(_row(po, sm, "skip_status", reason=f"状态「{po.status_raw}」跳过"))
            continue
        if po.external_order_no in existing:
            rows.append(_row(po, sm, "duplicate", reason="订单号已存在，跳过"))
            continue

        order_date = po.order_date or (po.payment_time.date() if po.payment_time else None)
        if order_date is None:
            rows.append(_row(po, sm, "unresolved", reason="缺少下单/支付时间"))
            continue

        real_lines = [pl for pl in po.product_lines if not pl.is_shipping]
        shipping_total = sum(
            (pl.unit_price * pl.quantity for pl in po.product_lines if pl.is_shipping),
            Decimal("0"),
        )
        # 忽略名单：整单只有忽略品 → 跳过（不导入、不进待确认）；多商品单里的忽略行被丢弃、
        # 其余照常导入。
        ignored_lines = [pl for pl in real_lines if _is_ignored_product(pl.name)]
        real_lines = [pl for pl in real_lines if not _is_ignored_product(pl.name)]
        zto_override = any(pl.mentions_zto for pl in po.product_lines)
        if not real_lines:
            if ignored_lines:
                rows.append(_row(po, sm, "skip_status",
                                 reason="已忽略（特殊品/对公/电子刊等，不导入）"))
            else:
                rows.append(_row(po, sm, "unresolved", reason="无可识别的商品行"))
            continue

        warnings: List[str] = []
        resolved = []
        miss_reason = None
        miss_product = None
        for idx, line in enumerate(real_lines):
            # single real line carries (paid − shipping); rare multi-line keeps own price.
            line_paid = (
                po.paid_amount - shipping_total
                if len(real_lines) == 1
                else line.unit_price * line.quantity
            )
            res = resolve_product(products, line.name, line.quantity, line_paid)
            if not res.matched:
                # 商学院月刊单期没有稳定的商品库键，按模式直接识别为商学院单期，期次身份落
                # issue_label —— 不在商品库建带年份的行。两种触发：
                #   (a) 标题/分册名含「YYYY年X月刊」→ 解析出具体期次 issue_label；
                #   (b) 淘宝多商品单的「【YYYY单期】《商学院》」行（导出无分册名、无月份）→
                #       仍按商学院单期落库，但期次留空 + 标黄请操作员补。
                # 均要求不含「中国经营报」（镜像前端 guessDefaults 的护栏），否则一条带日期的
                # 中国经营报行会被误记为商学院、且绕过待确认队列。
                issue_label = normalize_business_school_issue_label(line.name)
                # 淘宝多商品单的「【YYYY单期】《商学院》」行（无分册名 → 无月份）。要求带 4 位
                # 年份，避免日后某个含「单期】」的非商学院商品名误命中。
                is_bs_single_issue = (
                    bool(re.search(r"【\d{4}\s*单期】", line.name)) and "商学院" in line.name
                )
                if "中国经营报" not in line.name and (issue_label or is_bs_single_issue):
                    item = _make_item(
                        publication=Publication.business_school,
                        publication_format=PublicationFormat.paper,
                        fulfillment_type=FulfillmentType.single_issue,
                        billing_type=BillingType.paid,
                        subscription_term=None,
                        delivery_method=None,
                        total_quantity=line.quantity,
                        share=Decimal(str(line_paid)),
                    )
                    if issue_label:
                        item.issue_label = issue_label
                    else:
                        msg = "商学院单期：请补该单期次（导出无分册名）"
                        if msg not in warnings:
                            warnings.append(msg)
                    resolved.append(
                        ResolvedItem(item=item, coverage_rule=CoverageRule.custom)
                    )
                    continue
                miss_reason = res.reason
                miss_product = line.name
                break
            # Matched: tag a 商学院 single-issue line (a cataloged monthly issue) with the
            # label parsed from this line. Guard on publication so a 中国经营报 back-issue —
            # identified by 期号, never by a month label — is never mislabeled.
            issue_label = normalize_business_school_issue_label(line.name)
            if issue_label:
                for ri in res.items:
                    if (
                        ri.item.fulfillment_type == FulfillmentType.single_issue
                        and ri.item.publication == Publication.business_school
                        and not ri.item.issue_label
                    ):
                        ri.item.issue_label = issue_label
            warnings.extend(res.warnings)
            resolved.extend(res.items)
        if miss_reason:
            rows.append(
                _row(po, sm, "unresolved", reason=miss_reason, unresolved_product=miss_product)
            )
            continue

        items = []
        for ri in resolved:
            item = ri.item
            # Flip an item's own channel to 中通, but don't invent one for a line that
            # deliberately has none (e.g. the 商学院 single-issue fallback, delivery=None).
            if zto_override and item.delivery_method is not None:
                item.delivery_method = DeliveryMethod.zto_mf
            item.coverage_start_date, item.coverage_end_date = _coverage_for(
                settings, item, ri.coverage_rule, po.payment_time
            )
            # 最新一期：按"付款时间 + 刊期表 + 周五~22点翻期(±4h临界)"自动判期号；临界标黄待核。
            if ri.coverage_rule == CoverageRule.latest_issue:
                li = resolve_latest_issue(schedule, po.payment_time)
                item.issue_number = li.issue_number
                if li.note:
                    warnings.append(li.note)
            # 往期零售（自定义单期，既无期号也无期次标签）：具体期号靠客服按单告知，
            # 导入留空 + 标黄提醒补，免得漏填导致发货不知发哪期。
            elif (
                ri.coverage_rule == CoverageRule.custom
                and item.fulfillment_type == FulfillmentType.single_issue
                and item.publication == Publication.cbj
                and item.issue_number is None
                and not item.issue_label
            ):
                warnings.append("往期单：请补该单实际期号（客服确认）")
            item.targets = [
                FulfillmentTargetIn(
                    recipient_name=po.recipient_name or "(未填写)",
                    recipient_phone=po.recipient_phone or None,
                    recipient_address=po.recipient_address or "(未填写)",
                    recipient_postal_code=po.recipient_postal_code,
                    quantity=item.total_quantity,
                )
            ]
            items.append(item)

        # Campaign gift (e.g. 618 送《商学院》合刊): one free recorded line per order
        # that contains a subscription. Single-issue-only orders don't get it.
        if settings.gift_publication and any(
            it.fulfillment_type == FulfillmentType.subscription for it in items
        ):
            items.append(_gift_item(settings, po))

        oc = OrderCreate(
            external_order_no=po.external_order_no,
            order_date=order_date,
            source_platform=source_platform,
            source_store=source_store,
            campaign=settings.campaign,
            payer_name=po.recipient_name or "(未填写)",
            payer_contact=po.recipient_phone or None,
            payment_method=_payment_method(po.payment_method_raw),
            total_amount=po.paid_amount,
            paid_amount=po.paid_amount,
            original_amount=po.original_amount,
            invoice_required=bool(po.invoice_raw and po.invoice_raw.strip() not in ("", "\\n")),
            notes=po.notes or None,
            items=items,
        )
        rows.append(
            _row(
                po,
                sm,
                "import",
                status_unknown=sm.unknown,
                delivery_overridden_to_zto=zto_override,
                warnings=warnings,
                order_create=oc,
            )
        )

    return ImportPreview(rows)


# ---------------------------------------------------------------------------
# Preview / commit (cached session handoff)
# ---------------------------------------------------------------------------


def _serialize_row(r: PreviewRow) -> dict:
    items = []
    if r.order_create:
        for it in r.order_create.items:
            items.append(
                {
                    "publication": it.publication.value if it.publication else None,
                    "fulfillment_type": it.fulfillment_type.value,
                    "billing_type": it.billing_type.value,
                    "subscription_term": it.subscription_term.value if it.subscription_term else None,
                    "delivery_method": it.delivery_method.value if it.delivery_method else None,
                    "issue_label": it.issue_label,
                    "issue_number": it.issue_number,
                    "total_quantity": it.total_quantity,
                    "unit_price": str(it.unit_price),
                    "subtotal": str(it.subtotal),
                    "coverage_start_date": it.coverage_start_date.isoformat() if it.coverage_start_date else None,
                    "coverage_end_date": it.coverage_end_date.isoformat() if it.coverage_end_date else None,
                }
            )
    return {
        "external_order_no": r.external_order_no,
        "recipient_name": r.recipient_name,
        "paid_amount": str(r.paid_amount),
        "status_raw": r.status_raw,
        "commercial_status": r.commercial_status.value if r.commercial_status else None,
        "decision": r.decision,
        "reason": r.reason,
        "status_unknown": r.status_unknown,
        "delivery_overridden_to_zto": r.delivery_overridden_to_zto,
        "warnings": r.warnings,
        "items": items,
        "unresolved_product": r.unresolved_product,
    }


def _detect_and_parse(
    file_bytes: bytes,
) -> Tuple[List[ParsedOrder], str, Optional[str]]:
    """Sniff the export format and parse it.

    Returns ``(orders, source_platform, source_store)``. 淘宝 and CBJ exports have
    disjoint header signatures (订单编号+商品标题 vs 订单号+产品名称), so detection is
    unambiguous; both produce the same ``ParsedOrder`` shape and feed the identical
    downstream (resolver / status map / coverage / dedup / order create).
    """
    if is_taobao_export(file_bytes):
        return parse_taobao_orders(file_bytes), TAOBAO_PLATFORM, TAOBAO_STORE
    if is_cbj_export(file_bytes):
        return parse_cbj_orders(file_bytes), CBJ_PLATFORM, None
    raise ValueError(
        "无法识别的订单导出格式：表头既不匹配 CBJ（订单号 / 产品名称），"
        "也不匹配淘宝（订单编号 / 商品标题）"
    )


def preview_import(db: Session, file_bytes: bytes, settings: BatchSettings) -> Tuple[dict, str]:
    """Parse + resolve the upload, cache the importable rows, return a preview.

    The platform is auto-detected from the file header so a single upload box serves
    both CBJ 小程序 and 淘宝 exports, and each order gets the right source_platform.
    """
    parsed, source_platform, source_store = _detect_and_parse(file_bytes)
    preview = build_import_preview(
        db, parsed, settings, source_platform=source_platform, source_store=source_store
    )

    commit_rows = [
        {
            "order_create": r.order_create.model_dump(mode="json"),
            "commercial_status": r.commercial_status.value if r.commercial_status else None,
            "source_status_raw": r.status_raw,
            "is_historical_archive": settings.mode == "historical",
        }
        for r in preview.by_decision("import")
    ]
    session_id = save_order_import_session({"mode": settings.mode, "rows": commit_rows})

    out = {
        "session_id": session_id,
        "counts": preview.counts,
        "can_commit": preview.counts.get("import", 0) > 0,
        "rows": [_serialize_row(r) for r in preview.rows],
    }
    return out, session_id


def commit_import(
    db: Session,
    session_id: str,
    operator_id: Optional[int] = None,
    issue_overrides: Optional[dict[str, int]] = None,
) -> dict:
    """Create the previewed importable orders atomically (single commit).

    ``issue_overrides`` (optional) maps ``external_order_no`` → 期号 for 往期
    单 whose issue number was blank at preview (客服 tells it per order). Each
    override is applied only to that order's **single_issue item(s) that still
    lack an issue_number** — subscription rows and already-numbered items are
    never touched. Unknown 单号 are ignored (kept 选填, never blocks the commit).
    """
    payload = pop_order_import_session(session_id)
    if payload is None:
        raise HTTPException(status_code=400, detail="导入会话不存在或已过期，请重新预览")

    rows = payload["rows"]

    if issue_overrides:
        for r in rows:
            ext = r["order_create"].get("external_order_no")
            if ext is None or ext not in issue_overrides:
                continue
            issue_no = issue_overrides[ext]
            for item in r["order_create"].get("items", []):
                if item.get("fulfillment_type") == "single_issue" and not item.get("issue_number"):
                    item["issue_number"] = issue_no

    existing = {
        e
        for (e,) in db.query(Order.external_order_no)
        .filter(Order.external_order_no.isnot(None))
        .all()
    }
    to_create = [r for r in rows if r["order_create"]["external_order_no"] not in existing]
    skipped = len(rows) - len(to_create)

    # Block-allocate order codes per order year (historical batches span years).
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
            commercial_status=(
                OrderCommercialStatus(r["commercial_status"]) if r["commercial_status"] else None
            ),
            source_status_raw=r["source_status_raw"],
            is_historical_archive=r["is_historical_archive"],
            operator_id=operator_id,
        )
        created.append(order)

    db.commit()
    return {
        "created": len(created),
        "order_ids": [o.id for o in created],
        "skipped_duplicates": skipped,
    }
