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
* ``compute_fulfillment_progress`` — Per-item progress summary including
  linked shipping detail counts.

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

import enum
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from app.models import (
    FulfillmentAllocation,
    FulfillmentTarget,
    Order,
    OrderCommercialStatus,
    OrderEntryMethod,
    OrderEventType,
    OrderItem,
    OrderStatus,
    Payment,
    Refund,
    ShippingDetail,
)
from app.models.fulfillment_target import ShippingChannel
from app.models.order_item import OrderItemStatus, SubscriptionTerm
from app.models.shipping_detail import (
    ShippingDetailSourceType,
    ShippingDetailSyncStatus,
)
from app.schemas.order import (
    FulfillmentProgress,
    OrderCreate,
    OrderItemsUpdate,
    OrderListRow,
    OrderUpdate,
)
from app.services.expected_issues_calculator import compute_expected_issues
from app.services.order_code_service import generate_order_code
from app.services.order_event_logger import log_event
from app.services.order_pricing_service import build_pricing_preview


# Fields safe to edit on an ``active`` order. Structural fields
# (items / payer_name / order_date) are blocked until V1.2 introduces
# version-switching. ``entry_method`` is provenance metadata — set by
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
# Helpers
# ---------------------------------------------------------------------------


def _serialize_for_event(val):
    """Convert a value to JSON-safe format for event payloads."""
    if val is None:
        return None
    if isinstance(val, enum.Enum):
        return val.value
    if isinstance(val, Decimal):
        return str(val)
    if isinstance(val, (date, datetime)):
        return val.isoformat()
    return val


def _targets_differ(
    current_targets: list,
    new_targets: list,
) -> bool:
    """Compare current targets with submitted targets to detect changes.

    Uses multiset comparison of normalized signatures covering all
    semantically meaningful fields.
    """
    from collections import Counter

    if len(current_targets) != len(new_targets):
        return True

    def sig(t):
        return (
            t.recipient_name,
            getattr(t, "recipient_phone", None),
            t.recipient_address,
            getattr(t, "recipient_postal_code", None),
            t.quantity,
            getattr(t, "shipping_channel", ShippingChannel.zto_outsource),
            getattr(t, "effective_from_issue", None),
            getattr(t, "effective_until_issue", None),
            getattr(t, "notes", None),
        )

    return Counter(sig(t) for t in current_targets) != Counter(sig(t) for t in new_targets)


def _update_existing_item(
    db: Session,
    order: Order,
    item: OrderItem,
    item_data,
    effective_from_issue: int,
    change_reason: Optional[str],
    operator_id: Optional[int],
) -> None:
    """Update an existing item's fields and create new allocation if targets changed."""
    item_diff: dict = {}
    field_map = {
        "publication": item_data.publication,
        "publication_format": item_data.publication_format,
        "fulfillment_type": item_data.fulfillment_type,
        "billing_type": item_data.billing_type,
        "subscription_term": item_data.subscription_term,
        "delivery_method": item_data.delivery_method,
        "term_start_month": item_data.term_start_month,
        "coverage_start_date": item_data.coverage_start_date,
        "coverage_end_date": item_data.coverage_end_date,
        "issue_number": item_data.issue_number,
        "total_quantity": item_data.total_quantity,
        "unit_price": item_data.unit_price,
        "subtotal": item_data.subtotal,
        "notes": item_data.notes,
    }
    for field, new_val in field_map.items():
        old_val = getattr(item, field)
        if old_val != new_val:
            item_diff[field] = {
                "from": _serialize_for_event(old_val),
                "to": _serialize_for_event(new_val),
            }
            setattr(item, field, new_val)

    current_alloc = max(
        (a for a in item.allocations if a.effective_until_issue is None),
        key=lambda a: a.version_no,
        default=None,
    )
    current_targets = current_alloc.targets if current_alloc else []

    targets_changed = _targets_differ(current_targets, item_data.targets)

    if targets_changed and current_alloc:
        current_alloc.effective_until_issue = effective_from_issue - 1

        new_version = current_alloc.version_no + 1
        new_alloc = FulfillmentAllocation(
            order_item_id=item.id,
            version_no=new_version,
            effective_from_issue=effective_from_issue,
            effective_until_issue=None,
            change_reason=change_reason or "item targets updated",
            operator_id=operator_id,
        )
        db.add(new_alloc)
        db.flush()
        item.allocations.append(new_alloc)
        new_alloc.targets = []

        for tgt_data in item_data.targets:
            target = FulfillmentTarget(
                order_item_id=item.id,
                allocation_id=new_alloc.id,
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
            new_alloc.targets.append(target)
            item.targets.append(target)

    if item_diff or targets_changed:
        log_event(
            db,
            order_id=order.id,
            event_type=OrderEventType.item_modified,
            payload={
                "item_id": item.id,
                "field_diff": item_diff if item_diff else None,
                "targets_changed": targets_changed,
                "effective_from_issue": effective_from_issue,
                "change_reason": change_reason,
            },
            operator_id=operator_id,
        )


def _add_new_item(
    db: Session,
    order: Order,
    item_data,
    effective_from_issue: int,
    change_reason: Optional[str],
    operator_id: Optional[int],
) -> None:
    """Create a brand new item + allocation v1 + targets."""
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
        issue_label=item_data.issue_label,
        total_quantity=item_data.total_quantity,
        unit_price=item_data.unit_price,
        subtotal=item_data.subtotal,
        notes=item_data.notes,
    )
    db.add(item)
    db.flush()
    order.items.append(item)
    item.allocations = []
    item.targets = []

    alloc = FulfillmentAllocation(
        order_item_id=item.id,
        version_no=1,
        effective_from_issue=effective_from_issue,
        effective_until_issue=None,
        change_reason=change_reason or "new item added to active order",
        operator_id=operator_id,
    )
    db.add(alloc)
    db.flush()
    item.allocations.append(alloc)
    alloc.targets = []

    for tgt_data in item_data.targets:
        target = FulfillmentTarget(
            order_item_id=item.id,
            allocation_id=alloc.id,
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
        alloc.targets.append(target)
        item.targets.append(target)

    log_event(
        db,
        order_id=order.id,
        event_type=OrderEventType.item_added,
        payload={
            "item_id": item.id,
            "effective_from_issue": effective_from_issue,
            "change_reason": change_reason,
        },
        operator_id=operator_id,
    )


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------


def _build_order_items(
    db: Session,
    order: Order,
    items_data,
    operator_id: Optional[int],
    *,
    apply_package_pricing: bool,
) -> List[OrderItem]:
    """Create OrderItem + v1 FulfillmentAllocation + FulfillmentTargets for each
    item under ``order`` (which must already be flushed so ``order.id`` is set).
    Returns the created items.

    When ``apply_package_pricing`` is True (manual entry), a standard
    subscription item (term != custom, with delivery_method + term_start_month)
    has its coverage/price auto-filled from ``build_pricing_preview``. Import
    paths pass False: they carry the actual paid price/coverage resolved upstream
    and must not be overwritten by the standard package price table.
    """
    created: List[OrderItem] = []
    for item_data in items_data:
        coverage_start_date = item_data.coverage_start_date
        coverage_end_date = item_data.coverage_end_date
        unit_price = item_data.unit_price
        subtotal = item_data.subtotal
        if (
            apply_package_pricing
            and item_data.subscription_term is not None
            and item_data.subscription_term != SubscriptionTerm.custom
            and item_data.delivery_method is not None
            and item_data.term_start_month is not None
        ):
            preview = build_pricing_preview(
                db,
                subscription_term=item_data.subscription_term,
                delivery_method=item_data.delivery_method,
                term_start_month=item_data.term_start_month,
                total_quantity=item_data.total_quantity,
            )
            coverage_start_date = preview.coverage_start_date
            coverage_end_date = preview.coverage_end_date
            unit_price = preview.unit_price
            subtotal = preview.subtotal

        item = OrderItem(
            order_id=order.id,
            publication=item_data.publication,
            publication_format=item_data.publication_format,
            fulfillment_type=item_data.fulfillment_type,
            billing_type=item_data.billing_type,
            subscription_term=item_data.subscription_term,
            delivery_method=item_data.delivery_method,
            term_start_month=item_data.term_start_month,
            coverage_start_date=coverage_start_date,
            coverage_end_date=coverage_end_date,
            issue_number=item_data.issue_number,
            total_quantity=item_data.total_quantity,
            unit_price=unit_price,
            subtotal=subtotal,
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
            operator_id=operator_id,
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

        created.append(item)

    db.flush()
    return created


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
        # 录入方式 provenance 由服务端控制，不信任客户端传入值。
        # 本路径仅服务于手工录入入口（FastAPI 前端表单），固定写 manual。
        # Excel 批量导入 / API 同步由各自的入口函数固定写 `excel_import` / `api_sync`。
        entry_method=OrderEntryMethod.manual,
        source_platform=data.source_platform,
        source_store=data.source_store,
        external_order_no=data.external_order_no,
        payer_name=data.payer_name,
        payer_contact=data.payer_contact,
        payment_method=data.payment_method,
        payment_collector=data.payment_collector,
        total_amount=data.total_amount,
        paid_amount=data.paid_amount,
        original_amount=data.original_amount,
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

    _build_order_items(db, order, data.items, created_by, apply_package_pricing=True)

    log_event(
        db,
        order_id=order.id,
        event_type=OrderEventType.created,
        payload={
            # 与 order.entry_method 保持一致（服务端硬设的 manual），不读 data
            "entry_method": OrderEntryMethod.manual.value,
            "items_count": len(data.items),
        },
        operator_id=created_by,
    )
    db.commit()
    db.refresh(order)
    return order


def create_imported_order(
    db: Session,
    data: OrderCreate,
    *,
    order_code: str,
    import_batch_id: Optional[int] = None,
    import_row_no: Optional[int] = None,
    import_source_sheet: Optional[str] = None,
    commercial_status: Optional[OrderCommercialStatus] = None,
    source_status_raw: Optional[str] = None,
    is_historical_archive: bool = False,
    operator_id: Optional[int] = None,
) -> Order:
    """Create an **active** order from one batch-import row.

    Unlike :func:`create_order_draft` this entry point:

    * forces ``entry_method=excel_import`` (provenance is owned by the entry
      point, never trusted from the row);
    * stamps the import hook columns and emits the ``imported`` audit event;
    * assigns the (pre-allocated) ``order_code`` and snapshots
      ``expected_issues_at_creation`` — i.e. confirm-on-commit straight to
      ``active`` so the order is list-visible and shipping-syncable;
    * carries the actual paid price / coverage as-is (no package-price override);
    * **does not commit** — the import service builds many orders and commits
      the whole batch once, so a mid-batch failure rolls the entire batch back.

    The caller is responsible for allocating a unique ``order_code`` (see
    ``order_code_service.allocate_order_codes``) and for committing.
    """
    order = Order(
        order_code=order_code,
        order_date=data.order_date,
        entry_method=OrderEntryMethod.excel_import,
        source_platform=data.source_platform,
        source_store=data.source_store,
        campaign=data.campaign,
        external_order_no=data.external_order_no,
        payer_name=data.payer_name,
        payer_contact=data.payer_contact,
        payment_method=data.payment_method,
        payment_collector=data.payment_collector,
        total_amount=data.total_amount,
        paid_amount=data.paid_amount,
        original_amount=data.original_amount,
        invoice_required=data.invoice_required,
        invoice_title=data.invoice_title,
        invoice_tax_no=data.invoice_tax_no,
        invoice_recipient_email=data.invoice_recipient_email,
        notes=data.notes,
        status=OrderStatus.active,
        commercial_status=commercial_status,
        source_status_raw=source_status_raw,
        is_historical_archive=is_historical_archive,
        import_batch_id=import_batch_id,
        import_row_no=import_row_no,
        import_source_sheet=import_source_sheet,
        created_by=operator_id,
    )
    db.add(order)
    db.flush()

    items = _build_order_items(
        db, order, data.items, operator_id, apply_package_pricing=False
    )

    for item in items:
        item.expected_issues_at_creation = compute_expected_issues(
            db,
            coverage_start=item.coverage_start_date,
            coverage_end=item.coverage_end_date,
            fulfillment_type=item.fulfillment_type,
            publication=item.publication,
        )

    log_event(
        db,
        order_id=order.id,
        event_type=OrderEventType.imported,
        payload={
            "entry_method": OrderEntryMethod.excel_import.value,
            "order_code": order.order_code,
            "external_order_no": data.external_order_no,
            "import_batch_id": import_batch_id,
            "import_row_no": import_row_no,
            "items_count": len(data.items),
        },
        operator_id=operator_id,
    )
    db.flush()
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
        raise HTTPException(status_code=404, detail=f"订单 {order_id} 不存在")
    if order.status == OrderStatus.active:
        raise HTTPException(status_code=409, detail="订单已激活")
    if order.status == OrderStatus.void:
        raise HTTPException(
            status_code=409, detail="已作废的订单无法确认"
        )

    if not order.order_code:
        order.order_code = generate_order_code(db, order.order_date.year)

    for item in order.items:
        item.expected_issues_at_creation = compute_expected_issues(
            db,
            coverage_start=item.coverage_start_date,
            coverage_end=item.coverage_end_date,
            fulfillment_type=item.fulfillment_type,
            publication=item.publication,
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
        raise HTTPException(status_code=404, detail=f"订单 {order_id} 不存在")
    if order.status == OrderStatus.void:
        raise HTTPException(status_code=409, detail="已作废的订单无法修改")

    update_dict = data.model_dump(exclude_unset=True)
    is_active = order.status == OrderStatus.active

    diff: dict = {}
    for field, new_val in update_dict.items():
        if is_active and field not in ACTIVE_EDITABLE_FIELDS:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"字段「{field}」不可在已激活订单上修改"
                    "（结构性修改将于 V1.2 版本支持）"
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


def _orphan_order_generated_details(
    db: Session,
    order_id: int,
    *,
    order_item_id: Optional[int] = None,
    from_issue: Optional[int] = None,
) -> int:
    """Mark this order's ``order_generated`` shipping_details as ``orphaned``.

    Stops the rows being exported / shipped. Returns the number of rows touched
    (already-orphaned rows are skipped). Manual rows (``order_id`` NULL or
    ``source_type=manual``) are never touched — they aren't owned by this order.

    Optional scope (used by partial refunds):
    * ``order_item_id`` — only that item's rows (退某条明细).
    * ``from_issue``    — only issues ``>= from_issue`` (订阅从某期起停发).
    No scope → all of the order's generated rows (void / full refund / cancel).
    """
    q = db.query(ShippingDetail).filter(
        ShippingDetail.order_id == order_id,
        ShippingDetail.source_type == ShippingDetailSourceType.order_generated,
        ShippingDetail.sync_status != ShippingDetailSyncStatus.orphaned,
    )
    if order_item_id is not None:
        q = q.filter(ShippingDetail.order_item_id == order_item_id)
    if from_issue is not None:
        q = q.filter(ShippingDetail.issue_number >= from_issue)
    rows = q.all()
    for row in rows:
        row.sync_status = ShippingDetailSyncStatus.orphaned
    return len(rows)


def void_order(
    db: Session,
    order_id: int,
    reason: str,
    operator_id: Optional[int] = None,
) -> Order:
    """Mark order ``void``, orphan its generated shipping details, log it.

    Voiding an order that already produced ``order_generated`` 发货明细 must
    retract those rows, otherwise the courier export would still ship a
    cancelled order. The rows are flipped to ``orphaned`` (not deleted) so the
    audit trail and any manual edits survive; the ZTO export filters them out.
    """
    order = db.query(Order).filter(Order.id == order_id).first()
    if order is None:
        raise HTTPException(status_code=404, detail=f"订单 {order_id} 不存在")
    if order.status == OrderStatus.void:
        raise HTTPException(status_code=409, detail="订单已作废")

    order.status = OrderStatus.void
    orphaned_count = _orphan_order_generated_details(db, order_id)
    log_event(
        db,
        order_id=order.id,
        event_type=OrderEventType.voided,
        payload={"reason": reason, "orphaned_shipping_details": orphaned_count},
        operator_id=operator_id,
    )
    db.commit()
    db.refresh(order)
    return order


def _as_money(value) -> Decimal:
    """Coerce a possibly-None/int/float DB amount to a 2-dp Decimal."""
    return Decimal(str(value if value is not None else 0))


def refund_order(
    db: Session,
    order_id: int,
    *,
    amount: Decimal,
    reason: Optional[str] = None,
    order_item_id: Optional[int] = None,
    stop_from_issue: Optional[int] = None,
    refunded_at: Optional[date] = None,
    operator_id: Optional[int] = None,
) -> Order:
    """Record one refund line (full or partial) against an order.

    Updates ``refunded_amount`` + ``commercial_status`` and stops the scoped
    delivery (orphans the matching ``order_generated`` shipping rows). Refund is
    a commercial event — it never touches the internal ``OrderStatus``.

    Scope (covers all three partial-refund shapes):
    * no scope                  → money-only, delivery unchanged
    * ``order_item_id``         → orphan that item's future generated rows
    * ``stop_from_issue``       → orphan that scope from the given issue onward
    A refund whose cumulative total reaches ``paid_amount`` becomes a full refund
    (``commercial_status=refunded``) and stops ALL delivery.
    """
    order = db.query(Order).filter(Order.id == order_id).first()
    if order is None:
        raise HTTPException(status_code=404, detail=f"订单 {order_id} 不存在")
    if order.status == OrderStatus.void:
        raise HTTPException(status_code=409, detail="已作废的订单无法退款")

    amount = _as_money(amount)
    if amount <= 0:
        raise HTTPException(status_code=422, detail="退款金额必须大于 0")
    if order_item_id is not None and not any(
        it.id == order_item_id for it in order.items
    ):
        raise HTTPException(
            status_code=422, detail=f"明细 {order_item_id} 不属于该订单"
        )

    paid = _as_money(order.paid_amount)
    already = _as_money(order.refunded_amount)
    if already + amount > paid:
        raise HTTPException(
            status_code=422,
            detail=f"退款额超过可退余额（实付 {paid}、已退 {already}）",
        )

    db.add(
        Refund(
            order_id=order.id,
            order_item_id=order_item_id,
            amount=amount,
            reason=reason,
            stop_from_issue=stop_from_issue,
            refunded_at=refunded_at or date.today(),
            operator_id=operator_id,
        )
    )
    order.refunded_amount = already + amount
    is_full = order.refunded_amount >= paid
    order.commercial_status = (
        OrderCommercialStatus.refunded
        if is_full
        else OrderCommercialStatus.partial_refund
    )

    if is_full:
        orphaned = _orphan_order_generated_details(db, order_id)
    elif order_item_id is not None or stop_from_issue is not None:
        orphaned = _orphan_order_generated_details(
            db, order_id, order_item_id=order_item_id, from_issue=stop_from_issue
        )
    else:
        orphaned = 0  # 纯退钱、履约不变

    log_event(
        db,
        order_id=order.id,
        event_type=OrderEventType.refunded,
        payload={
            "amount": str(amount),
            "order_item_id": order_item_id,
            "stop_from_issue": stop_from_issue,
            "is_full": is_full,
            "refunded_amount_total": str(order.refunded_amount),
            "orphaned_shipping_details": orphaned,
            "reason": reason,
        },
        operator_id=operator_id,
    )
    db.commit()
    db.refresh(order)
    return order


def cancel_order(
    db: Session,
    order_id: int,
    *,
    reason: str,
    refunded_at: Optional[date] = None,
    operator_id: Optional[int] = None,
) -> Order:
    """Cancel an order: mark ``commercial_status=cancelled``, record a full refund
    of the outstanding paid amount (实付 − 已退), and stop ALL delivery.

    Like refund, cancel is a commercial event — the internal ``OrderStatus`` stays
    as-is (use ``void`` for "this order shouldn't exist").
    """
    order = db.query(Order).filter(Order.id == order_id).first()
    if order is None:
        raise HTTPException(status_code=404, detail=f"订单 {order_id} 不存在")
    if order.status == OrderStatus.void:
        raise HTTPException(status_code=409, detail="已作废的订单无法取消")
    if order.commercial_status == OrderCommercialStatus.cancelled:
        raise HTTPException(status_code=409, detail="订单已取消")

    paid = _as_money(order.paid_amount)
    already = _as_money(order.refunded_amount)
    outstanding = paid - already
    refund_amount = outstanding if outstanding > 0 else Decimal("0")
    if refund_amount > 0:
        db.add(
            Refund(
                order_id=order.id,
                order_item_id=None,
                amount=refund_amount,
                reason=f"订单取消：{reason}",
                stop_from_issue=None,
                refunded_at=refunded_at or date.today(),
                operator_id=operator_id,
            )
        )
        order.refunded_amount = already + refund_amount

    order.commercial_status = OrderCommercialStatus.cancelled
    orphaned = _orphan_order_generated_details(db, order_id)
    log_event(
        db,
        order_id=order.id,
        event_type=OrderEventType.cancelled,
        payload={
            "reason": reason,
            "refund_amount": str(refund_amount),
            "orphaned_shipping_details": orphaned,
        },
        operator_id=operator_id,
    )
    db.commit()
    db.refresh(order)
    return order


def record_payment(
    db: Session,
    order_id: int,
    *,
    amount: Decimal,
    method: Optional[str] = None,
    collected_at: Optional[date] = None,
    notes: Optional[str] = None,
    operator_id: Optional[int] = None,
) -> Order:
    """记一笔收款（到账）：建收款流水行 + 累加 ``paid_amount`` + 记审计事件。

    收款是商业事件，不动内部 ``OrderStatus``。允许超付应收（预付/定金/应收后调），
    不硬拦；欠款按 max(0, 应收 − 实付) 展示。
    """
    order = db.query(Order).filter(Order.id == order_id).first()
    if order is None:
        raise HTTPException(status_code=404, detail=f"订单 {order_id} 不存在")
    if order.status == OrderStatus.void:
        raise HTTPException(status_code=409, detail="已作废的订单无法收款")

    amount = _as_money(amount)
    if amount <= 0:
        raise HTTPException(status_code=422, detail="收款金额必须大于 0")

    db.add(
        Payment(
            order_id=order.id,
            amount=amount,
            method=method,
            collected_at=collected_at or date.today(),
            notes=notes,
            operator_id=operator_id,
        )
    )
    order.paid_amount = _as_money(order.paid_amount) + amount
    log_event(
        db,
        order_id=order.id,
        event_type=OrderEventType.payment_recorded,
        payload={
            "amount": str(amount),
            "method": method,
            "paid_amount_total": str(order.paid_amount),
            "notes": notes,
        },
        operator_id=operator_id,
    )
    db.commit()
    db.refresh(order)
    return order


def update_order_items(
    db: Session,
    order_id: int,
    data: "OrderItemsUpdate",
    operator_id: Optional[int] = None,
) -> Order:
    """Update items/targets on an active order with versioned allocations.

    For each submitted item:
    - Items with ``id`` matching an existing item: update item-level fields
      in place; if targets changed, close current allocation and create a
      new version.
    - Items without ``id``: create as new (item + allocation v1 + targets).
    - Existing items NOT in the submitted list: mark as cancelled.

    ``data.effective_from_issue`` controls the boundary between the old
    and new allocation versions.
    """
    order = (
        db.query(Order)
        .options(
            selectinload(Order.items)
            .selectinload(OrderItem.allocations)
            .selectinload(FulfillmentAllocation.targets)
        )
        .filter(Order.id == order_id)
        .first()
    )

    if order is None:
        raise HTTPException(status_code=404, detail=f"订单 {order_id} 不存在")
    if order.status != OrderStatus.active:
        raise HTTPException(
            status_code=409,
            detail=f"仅可编辑已激活订单的明细（当前状态：{order.status.value}）",
        )

    existing_items = {
        item.id: item for item in order.items if item.status == OrderItemStatus.active
    }
    submitted_ids = {it.id for it in data.items if it.id is not None}

    unknown_ids = submitted_ids - set(existing_items.keys())
    if unknown_ids:
        raise HTTPException(
            status_code=422,
            detail=f"以下明细不属于该已激活订单：{sorted(unknown_ids)}",
        )

    id_list = [it.id for it in data.items if it.id is not None]
    if len(id_list) != len(set(id_list)):
        raise HTTPException(
            status_code=422,
            detail="请求中存在重复的明细 ID",
        )

    for item_id, item in existing_items.items():
        if item_id not in submitted_ids:
            item.status = OrderItemStatus.cancelled
            for alloc in item.allocations:
                if alloc.effective_until_issue is None:
                    alloc.effective_until_issue = data.effective_from_issue - 1
            log_event(
                db,
                order_id=order.id,
                event_type=OrderEventType.item_removed,
                payload={
                    "item_id": item_id,
                    "effective_from_issue": data.effective_from_issue,
                    "change_reason": data.change_reason,
                },
                operator_id=operator_id,
            )

    for item_data in data.items:
        if item_data.id is not None and item_data.id in existing_items:
            item = existing_items[item_data.id]
            _update_existing_item(
                db,
                order,
                item,
                item_data,
                data.effective_from_issue,
                data.change_reason,
                operator_id,
            )
        else:
            _add_new_item(
                db,
                order,
                item_data,
                data.effective_from_issue,
                data.change_reason,
                operator_id,
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
            selectinload(Order.refunds),
            selectinload(Order.payments),
        )
        .filter(Order.id == order_id)
        .first()
    )
    if order is None:
        raise HTTPException(status_code=404, detail=f"订单 {order_id} 不存在")
    return order


def compute_fulfillment_progress(
    db: Session,
    order_item: OrderItem,
) -> FulfillmentProgress:
    """Snapshot per-item fulfillment progress.

    Computes ``current_expected`` against the live schedule, derives
    ``drift`` from ``expected_issues_at_creation``, and counts linked
    ``shipping_details`` rows for ``synced_count``. 休刊-skip count
    (``skipped_count``) remains a V1.3 placeholder.
    """
    expected_at_creation = order_item.expected_issues_at_creation
    current_expected = compute_expected_issues(
        db,
        coverage_start=order_item.coverage_start_date,
        coverage_end=order_item.coverage_end_date,
        fulfillment_type=order_item.fulfillment_type,
        publication=order_item.publication,
    )
    drift = None
    if expected_at_creation is not None and current_expected is not None:
        drift = current_expected - expected_at_creation
    linked = db.query(ShippingDetail).filter(
        ShippingDetail.order_id == order_item.order_id,
        ShippingDetail.order_item_id == order_item.id,
    )
    synced_count = linked.count()
    shipped_count = linked.filter(ShippingDetail.shipped_at.isnot(None)).count()
    return FulfillmentProgress(
        expected_at_creation=expected_at_creation,
        current_expected=current_expected,
        drift=drift,
        synced_count=synced_count,
        shipped_count=shipped_count,
        skipped_count=0,
    )


def _build_list_row(db: Session, order: Order) -> OrderListRow:
    """Build one ``OrderListRow`` for ``order``, computing the derived
    coverage span, per-order drift, and ``expected_total`` against the live
    schedule. Drift compares each item's ``expected_issues_at_creation`` with
    the freshly-computed expectation."""
    items = list(order.items)
    total_quantity = sum((i.total_quantity or 0) for i in items)

    paid = _as_money(order.paid_amount)
    total = _as_money(order.total_amount)
    outstanding = total - paid
    if outstanding < 0:
        outstanding = Decimal("0")

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
            publication=item.publication,
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

    return OrderListRow(
        id=order.id,
        order_code=order.order_code,
        external_order_no=order.external_order_no,
        order_date=order.order_date,
        payer_name=order.payer_name,
        entry_method=order.entry_method,
        source_platform=order.source_platform,
        campaign=order.campaign,
        total_quantity=total_quantity,
        total_amount=order.total_amount,
        paid_amount=paid,
        outstanding_amount=outstanding,
        coverage_start_date=coverage_start_d,
        coverage_end_date=coverage_end_d,
        status=order.status,
        commercial_status=order.commercial_status,
        # column default (0) only applies on flush; coerce for unflushed/None rows
        refunded_amount=_as_money(order.refunded_amount),
        has_drift=order_drift,
        synced_count=0,
        expected_total=expected_total if any_expected else None,
    )


def list_orders(
    db: Session,
    status: Optional[OrderStatus] = None,
    entry_method: Optional[OrderEntryMethod] = None,
    payer_name_like: Optional[str] = None,
    campaign: Optional[str] = None,
    source_platform: Optional[str] = None,
    coverage_start: Optional[date] = None,
    coverage_end: Optional[date] = None,
    order_date_start: Optional[date] = None,
    order_date_end: Optional[date] = None,
    unpaid: Optional[bool] = None,
    has_drift: Optional[bool] = None,
    skip: int = 0,
    limit: int = 50,
) -> Tuple[List[OrderListRow], int]:
    """Filtered, paginated order list.

    Filters:

    * ``status``           — exact match.
    * ``entry_method``     — exact match.
    * ``payer_name_like``  — case-insensitive substring (LIKE %s%).
    * ``coverage_start`` / ``coverage_end`` — orders whose item coverage
      overlaps the provided range. NULL coverage on an item counts as
      open-ended on that side.
    * ``order_date_start`` / ``order_date_end`` — 下单日期闭区间（含端点），
      DB 层过滤（不再前端逐页客户端过滤，避免跨页不准）。
    * ``has_drift``        — per-order drift computed against the live
      schedule snapshot.

    Returns ``(rows, total)``.

    Pagination semantics depend on ``has_drift``:

    * ``has_drift is None`` — paginate at the SQL level; ``total`` is the
      DB-level filter count.
    * ``has_drift`` set — drift is a Python-computed predicate that can't be
      pushed into SQL, so the full filtered set is materialised, drift-filtered,
      and paginated in memory. ``total`` then reflects the **post-drift** count
      so every page is full and the count matches what's returned.
    """
    q = db.query(Order)
    if status is not None:
        q = q.filter(Order.status == status)
    if entry_method is not None:
        q = q.filter(Order.entry_method == entry_method)
    if payer_name_like:
        q = q.filter(Order.payer_name.ilike(f"%{payer_name_like}%"))
    if campaign:
        q = q.filter(Order.campaign == campaign)
    if source_platform:
        q = q.filter(Order.source_platform == source_platform)
    if order_date_start is not None:
        q = q.filter(Order.order_date >= order_date_start)
    if order_date_end is not None:
        q = q.filter(Order.order_date <= order_date_end)
    if unpaid is True:
        q = q.filter(Order.paid_amount < Order.total_amount)
    elif unpaid is False:
        q = q.filter(Order.paid_amount >= Order.total_amount)
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

    base = q.options(selectinload(Order.items)).order_by(Order.id.desc())

    if has_drift is None:
        # 不按偏差筛 → 直接在 SQL 层分页（每行的偏差仅用于展示，按本页逐单算）。
        total = q.count()
        rows = [_build_list_row(db, order) for order in base.offset(skip).limit(limit).all()]
        return rows, total

    # 按偏差筛：偏差是 Python 端按实时刊期表算的，无法下推到 SQL。取整批过滤后的订单、
    # 逐单算偏差、按 has_drift 过滤，再在内存里分页——这样每页都满 limit 条、且 total
    # 反映过滤后的真实条数（修正旧版"先 SQL 分页再丢行"导致的页面残缺 + total 不符）。
    all_rows = [_build_list_row(db, order) for order in base.all()]
    matched = [row for row in all_rows if row.has_drift == has_drift]
    return matched[skip : skip + limit], len(matched)
