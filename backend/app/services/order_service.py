"""Order service.

Implements the V1.1 lifecycle for订单管理:

* ``create_order_draft`` — Persists Order + items + **v1 allocation** + targets
  in a single transaction. Status starts as ``draft``.
* ``confirm_order``      — Generates ``order_code``, computes
  ``expected_issues_at_creation`` per item, transitions to ``active``.
* ``update_order``       — Patches editable fields. Active orders restrict
  edits to non-structural fields only (V1.2 will introduce a
  version-switching flow for structural edits).
* ``void_order``         — Terminal soft-delete; the row stays for audit.
* ``list_orders``        — Filterable + paginated list view with derived
  coverage range + per-order drift detection.
* ``get_order_detail``   — Eager-loaded order with items/allocations/targets.
* ``compute_fulfillment_progress`` — Per-item progress summary (synced_count
  is a V1.3 placeholder, always 0 for now).

Design decision (V1.1): we create the v1 ``FulfillmentAllocation`` during
``create_order_draft`` rather than at confirm time, because
``fulfillment_targets.allocation_id`` is ``NOT NULL`` in the schema and
targets are supplied in the draft payload. ``confirm_order`` therefore
does not re-create the allocation — it only stamps the code, snapshots
``expected_issues_at_creation`` against the live schedule, and flips
status. Reverting this requires relaxing the FK in a future migration.

All mutating helpers log an ``order_events`` row through
``order_event_logger.log_event`` so the audit trail is single-source.
"""

from datetime import date
from typing import List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from app.models import (
    FulfillmentAllocation,
    FulfillmentTarget,
    Order,
    OrderEventType,
    OrderItem,
    OrderSourceType,
    OrderStatus,
)
from app.schemas.order import (
    FulfillmentProgress,
    OrderCreate,
    OrderListRow,
    OrderUpdate,
)
from app.services.expected_issues_calculator import compute_expected_issues
from app.services.order_code_service import generate_order_code
from app.services.order_event_logger import log_event


# Fields safe to edit on an ``active`` order. Structural fields
# (items / payer_name / order_date) are blocked until V1.2 introduces
# version-switching. ``source_type`` is provenance metadata — set by
# the entry-point on creation and never editable in any status.
ACTIVE_EDITABLE_FIELDS = frozenset(
    {
        "notes",
        "payer_contact",
        "invoice_required",
        "invoice_title",
        "invoice_tax_no",
        "invoice_recipient_email",
        "payment_method",
        "payment_collector",
        "external_order_no",
        "source_platform",
        "source_store",
        "total_amount",
        "paid_amount",
    }
)


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------


def create_order_draft(
    db: Session,
    data: OrderCreate,
    created_by: Optional[int] = None,
) -> Order:
    """Persist a new draft order with items + v1 allocation + targets.

    Returns the refreshed ``Order`` after a successful commit. Caller is
    expected to surface validation errors via the Pydantic schema before
    calling this function — there is no business validation here beyond
    what the model constraints enforce.
    """
    order = Order(
        order_date=data.order_date,
        # V1.1: 录入方式 provenance 由服务端控制，不信任客户端传入值。
        # 本路径仅服务于手工录入入口（FastAPI 前端表单），固定写 manual。
        # V1.2 引入 Excel 批量导入 / API 同步时，将由各自的入口函数固定写
        # `excel_import` / `api_sync`（PR-B 后改为 entry_method 字段）。
        source_type=OrderSourceType.manual,
        source_platform=data.source_platform,
        source_store=data.source_store,
        external_order_no=data.external_order_no,
        payer_name=data.payer_name,
        payer_contact=data.payer_contact,
        payment_method=data.payment_method,
        payment_collector=data.payment_collector,
        total_amount=data.total_amount,
        paid_amount=data.paid_amount,
        invoice_required=data.invoice_required,
        invoice_title=data.invoice_title,
        invoice_tax_no=data.invoice_tax_no,
        invoice_recipient_email=data.invoice_recipient_email,
        notes=data.notes,
        status=OrderStatus.draft,
        created_by=created_by,
    )
    db.add(order)
    db.flush()

    for item_data in data.items:
        item = OrderItem(
            order_id=order.id,
            publication=item_data.publication,
            publication_format=item_data.publication_format,
            fulfillment_type=item_data.fulfillment_type,
            billing_type=item_data.billing_type,
            subscription_term=item_data.subscription_term,
            delivery_method=item_data.delivery_method,
            term_start_month=item_data.term_start_month,
            coverage_start_date=item_data.coverage_start_date,
            coverage_end_date=item_data.coverage_end_date,
            issue_number=item_data.issue_number,
            total_quantity=item_data.total_quantity,
            unit_price=item_data.unit_price,
            subtotal=item_data.subtotal,
            notes=item_data.notes,
        )
        db.add(item)
        db.flush()

        allocation = FulfillmentAllocation(
            order_item_id=item.id,
            version_no=1,
            effective_from_issue=None,
            effective_until_issue=None,
            change_reason="initial",
            operator_id=created_by,
        )
        db.add(allocation)
        db.flush()

        for tgt_data in item_data.targets:
            target = FulfillmentTarget(
                order_item_id=item.id,
                allocation_id=allocation.id,
                recipient_name=tgt_data.recipient_name,
                recipient_phone=tgt_data.recipient_phone,
                recipient_address=tgt_data.recipient_address,
                recipient_postal_code=tgt_data.recipient_postal_code,
                quantity=tgt_data.quantity,
                shipping_channel=tgt_data.shipping_channel,
                effective_from_issue=tgt_data.effective_from_issue,
                effective_until_issue=tgt_data.effective_until_issue,
                notes=tgt_data.notes,
            )
            db.add(target)

    db.flush()
    log_event(
        db,
        order_id=order.id,
        event_type=OrderEventType.created,
        payload={
            # 与 order.source_type 保持一致（服务端硬设的 manual），不读 data
            "source_type": OrderSourceType.manual.value,
            "items_count": len(data.items),
        },
        operator_id=created_by,
    )
    db.commit()
    db.refresh(order)
    return order


def confirm_order(
    db: Session,
    order_id: int,
    operator_id: Optional[int] = None,
) -> Order:
    """Generate code, snapshot expected_issues, transition draft → active.

    Idempotency: HTTP 409 if the order is already ``active`` or ``void``.
    """
    order = db.query(Order).filter(Order.id == order_id).first()
    if order is None:
        raise HTTPException(status_code=404, detail=f"order {order_id} not found")
    if order.status == OrderStatus.active:
        raise HTTPException(status_code=409, detail="order already active")
    if order.status == OrderStatus.void:
        raise HTTPException(
            status_code=409, detail="voided order cannot be confirmed"
        )

    if not order.order_code:
        order.order_code = generate_order_code(db, order.order_date.year)

    for item in order.items:
        item.expected_issues_at_creation = compute_expected_issues(
            db,
            coverage_start=item.coverage_start_date,
            coverage_end=item.coverage_end_date,
            fulfillment_type=item.fulfillment_type,
        )

    order.status = OrderStatus.active
    log_event(
        db,
        order_id=order.id,
        event_type=OrderEventType.confirmed,
        payload={"order_code": order.order_code},
        operator_id=operator_id,
    )
    db.commit()
    db.refresh(order)
    return order


def update_order(
    db: Session,
    order_id: int,
    data: OrderUpdate,
    operator_id: Optional[int] = None,
) -> Order:
    """Patch editable fields. Active orders restrict to ACTIVE_EDITABLE_FIELDS.

    The diff is recorded in the ``modified`` event payload so the audit
    log shows exactly what changed. Voided orders cannot be updated.
    """
    order = db.query(Order).filter(Order.id == order_id).first()
    if order is None:
        raise HTTPException(status_code=404, detail=f"order {order_id} not found")
    if order.status == OrderStatus.void:
        raise HTTPException(status_code=409, detail="voided order cannot be updated")

    update_dict = data.model_dump(exclude_unset=True)
    is_active = order.status == OrderStatus.active

    diff: dict = {}
    for field, new_val in update_dict.items():
        if is_active and field not in ACTIVE_EDITABLE_FIELDS:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"field '{field}' cannot be edited on active orders "
                    "(structural edits land in V1.2)"
                ),
            )
        old_val = getattr(order, field, None)
        if old_val != new_val:
            diff[field] = {
                "from": _serialize_for_event(old_val),
                "to": _serialize_for_event(new_val),
            }
            setattr(order, field, new_val)

    if diff:
        log_event(
            db,
            order_id=order.id,
            event_type=OrderEventType.modified,
            payload={"diff": diff},
            operator_id=operator_id,
        )
    db.commit()
    db.refresh(order)
    return order


def void_order(
    db: Session,
    order_id: int,
    reason: str,
    operator_id: Optional[int] = None,
) -> Order:
    """Mark order ``void`` and log the reason."""
    order = db.query(Order).filter(Order.id == order_id).first()
    if order is None:
        raise HTTPException(status_code=404, detail=f"order {order_id} not found")
    if order.status == OrderStatus.void:
        raise HTTPException(status_code=409, detail="order already void")

    order.status = OrderStatus.void
    log_event(
        db,
        order_id=order.id,
        event_type=OrderEventType.voided,
        payload={"reason": reason},
        operator_id=operator_id,
    )
    db.commit()
    db.refresh(order)
    return order


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


def get_order_detail(db: Session, order_id: int) -> Order:
    """Return order with items/allocations/targets eagerly loaded."""
    order = (
        db.query(Order)
        .options(
            selectinload(Order.items)
            .selectinload(OrderItem.allocations)
            .selectinload(FulfillmentAllocation.targets),
            selectinload(Order.items).selectinload(OrderItem.targets),
        )
        .filter(Order.id == order_id)
        .first()
    )
    if order is None:
        raise HTTPException(status_code=404, detail=f"order {order_id} not found")
    return order


def compute_fulfillment_progress(
    db: Session,
    order_item: OrderItem,
) -> FulfillmentProgress:
    """Snapshot per-item fulfillment progress.

    V1.1 only computes ``current_expected`` against the live schedule and
    derives ``drift`` from ``expected_issues_at_creation``. The actual
    synced row count (``synced_count``) and 休刊-skip count
    (``skipped_count``) land in V1.3 once shipping sync is in place.
    """
    expected_at_creation = order_item.expected_issues_at_creation
    current_expected = compute_expected_issues(
        db,
        coverage_start=order_item.coverage_start_date,
        coverage_end=order_item.coverage_end_date,
        fulfillment_type=order_item.fulfillment_type,
    )
    drift = None
    if expected_at_creation is not None and current_expected is not None:
        drift = current_expected - expected_at_creation
    return FulfillmentProgress(
        expected_at_creation=expected_at_creation,
        current_expected=current_expected,
        drift=drift,
        synced_count=0,
        skipped_count=0,
    )


def list_orders(
    db: Session,
    status: Optional[OrderStatus] = None,
    source_type: Optional[OrderSourceType] = None,
    payer_name_like: Optional[str] = None,
    coverage_start: Optional[date] = None,
    coverage_end: Optional[date] = None,
    has_drift: Optional[bool] = None,
    skip: int = 0,
    limit: int = 50,
) -> Tuple[List[OrderListRow], int]:
    """Filtered, paginated order list.

    Filters:

    * ``status``           — exact match.
    * ``source_type``      — exact match.
    * ``payer_name_like``  — case-insensitive substring (LIKE %s%).
    * ``coverage_start`` / ``coverage_end`` — orders whose item coverage
      overlaps the provided range. NULL coverage on an item counts as
      open-ended on that side.
    * ``has_drift``        — post-filter computed per-order by comparing
      ``expected_issues_at_creation`` with the current schedule snapshot.

    Returns ``(rows, total)``. ``total`` reflects the DB-level filter
    count *before* the in-memory drift filter so paging metadata stays
    consistent with what the server actually returned.
    """
    q = db.query(Order)
    if status is not None:
        q = q.filter(Order.status == status)
    if source_type is not None:
        q = q.filter(Order.source_type == source_type)
    if payer_name_like:
        q = q.filter(Order.payer_name.ilike(f"%{payer_name_like}%"))
    if coverage_start is not None or coverage_end is not None:
        item_q = db.query(OrderItem.order_id).distinct()
        if coverage_start is not None:
            item_q = item_q.filter(
                or_(
                    OrderItem.coverage_end_date.is_(None),
                    OrderItem.coverage_end_date >= coverage_start,
                )
            )
        if coverage_end is not None:
            item_q = item_q.filter(
                or_(
                    OrderItem.coverage_start_date.is_(None),
                    OrderItem.coverage_start_date <= coverage_end,
                )
            )
        q = q.filter(Order.id.in_(item_q))

    total = q.count()
    orders = (
        q.options(selectinload(Order.items))
        .order_by(Order.id.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )

    rows: List[OrderListRow] = []
    for order in orders:
        items = list(order.items)
        total_quantity = sum((i.total_quantity or 0) for i in items)

        starts = [i.coverage_start_date for i in items if i.coverage_start_date]
        ends = [i.coverage_end_date for i in items if i.coverage_end_date]
        coverage_start_d = min(starts) if starts else None
        coverage_end_d = max(ends) if ends else None

        order_drift = False
        expected_total: Optional[int] = 0
        any_expected = False
        for item in items:
            current = compute_expected_issues(
                db,
                coverage_start=item.coverage_start_date,
                coverage_end=item.coverage_end_date,
                fulfillment_type=item.fulfillment_type,
            )
            if current is not None:
                expected_total += current
                any_expected = True
            if (
                item.expected_issues_at_creation is not None
                and current is not None
                and current != item.expected_issues_at_creation
            ):
                order_drift = True

        if has_drift is True and not order_drift:
            continue
        if has_drift is False and order_drift:
            continue

        rows.append(
            OrderListRow(
                id=order.id,
                order_code=order.order_code,
                external_order_no=order.external_order_no,
                order_date=order.order_date,
                payer_name=order.payer_name,
                source_type=order.source_type,
                source_platform=order.source_platform,
                total_quantity=total_quantity,
                total_amount=order.total_amount,
                coverage_start_date=coverage_start_d,
                coverage_end_date=coverage_end_d,
                status=order.status,
                has_drift=order_drift,
                synced_count=0,
                expected_total=expected_total if any_expected else None,
            )
        )

    return rows, total


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _serialize_for_event(val):
    """Coerce a column value to something JSON-friendly for the audit log.

    Decimals become strings (to avoid precision loss in JSON), dates use
    isoformat, enums use ``.value``. None passes through.
    """
    if val is None:
        return None
    if hasattr(val, "isoformat"):
        return val.isoformat()
    if hasattr(val, "value"):
        return val.value
    return str(val)
