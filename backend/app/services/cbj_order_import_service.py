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

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Order, OrderCommercialStatus, OrderPaymentMethod, Product
from app.models.order_item import DeliveryMethod, SubscriptionTerm
from app.models.product import CoverageRule
from app.order_import_cache import pop_order_import_session, save_order_import_session
from app.schemas.order import FulfillmentTargetIn, OrderCreate
from app.services.cbj_order_import_parser import ParsedOrder, parse_cbj_orders
from app.services.order_code_service import allocate_order_codes
from app.services.order_import_status_service import map_commercial_status
from app.services.order_service import create_imported_order
from app.services.product_resolver_service import resolve_product

_SOURCE_PLATFORM = "CBJ小程序"

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
    return start, _add_months(start, months) - timedelta(days=1)


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


def build_import_preview(
    db: Session, parsed_orders: List[ParsedOrder], settings: BatchSettings
) -> ImportPreview:
    products = db.query(Product).filter(Product.active.is_(True)).all()
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
        zto_override = any(pl.mentions_zto for pl in po.product_lines)
        if not real_lines:
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
                miss_reason = res.reason
                miss_product = line.name
                break
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
            if zto_override:
                item.delivery_method = DeliveryMethod.zto_mf
            item.coverage_start_date, item.coverage_end_date = _coverage_for(
                settings, item, ri.coverage_rule, po.payment_time
            )
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

        oc = OrderCreate(
            external_order_no=po.external_order_no,
            order_date=order_date,
            source_platform=_SOURCE_PLATFORM,
            payer_name=po.recipient_name or "(未填写)",
            payer_contact=po.recipient_phone or None,
            payment_method=_payment_method(po.payment_method_raw),
            total_amount=po.paid_amount,
            paid_amount=po.paid_amount,
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
                    "subscription_term": it.subscription_term.value if it.subscription_term else None,
                    "delivery_method": it.delivery_method.value if it.delivery_method else None,
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


def preview_import(db: Session, file_bytes: bytes, settings: BatchSettings) -> Tuple[dict, str]:
    """Parse + resolve the upload, cache the importable rows, return a preview."""
    parsed = parse_cbj_orders(file_bytes)
    preview = build_import_preview(db, parsed, settings)

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


def commit_import(db: Session, session_id: str, operator_id: Optional[int] = None) -> dict:
    """Create the previewed importable orders atomically (single commit)."""
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
