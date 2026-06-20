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

from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import List, Optional

from sqlalchemy.orm import Session

from app.models import Order, OrderCommercialStatus, OrderPaymentMethod, Product
from app.models.order_item import DeliveryMethod, SubscriptionTerm
from app.models.product import CoverageRule
from app.schemas.order import FulfillmentTargetIn, OrderCreate
from app.services.cbj_order_import_parser import ParsedOrder
from app.services.order_import_status_service import map_commercial_status
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
                break
            warnings.extend(res.warnings)
            resolved.extend(res.items)
        if miss_reason:
            rows.append(_row(po, sm, "unresolved", reason=miss_reason))
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
