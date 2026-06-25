"""Order management REST API (V1.1).

All endpoints are mounted under ``/api/orders`` and require authentication
(applied at router-include time in ``main.py``). They are thin wrappers
around ``app.services.order_service`` — business rules, validation and
HTTP error semantics live there; this module just maps HTTP verbs to
service calls and serialises the result with the ``order`` schemas.

Endpoint map:

* ``GET    /api/orders``                              — list + filter + paginate
* ``GET    /api/orders/{id}``                         — detail (eager-loaded)
* ``POST   /api/orders``                              — create draft (201)
* ``PUT    /api/orders/{id}``                         — patch editable fields
* ``POST   /api/orders/{id}/confirm``                 — draft → active
* ``POST   /api/orders/{id}/void``                    — active/draft → void
* ``PUT    /api/orders/{id}/items``                   — batch-edit active items
* ``GET    /api/orders/{id}/shipping-sync/preview``   — preview ZTO-MF rows
* ``POST   /api/orders/{id}/shipping-sync/apply``     — create/update ZTO-MF rows
* ``GET    /api/orders/{id}/events``                  — audit log
* ``GET    /api/orders/{id}/fulfillment-progress``    — per-item progress

The list endpoint returns ``{"rows": [...], "total": N}`` so the frontend
can render pagination metadata without an extra round-trip.
"""

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import OrderEntryMethod, OrderStatus, User
from app.models.order_event import OrderEvent
from app.schemas.order import (
    FulfillmentProgress,
    OrderCreate,
    OrderEventOut,
    OrderShippingSyncApplyIn,
    OrderShippingSyncPreview,
    OrderItemsUpdate,
    OrderListRow,
    OrderOut,
    OrderUpdate,
    OrderVoidIn,
    PricingPreviewIn,
    PricingPreviewOut,
)
from app.services import order_service
from app.services.order_shipping_sync_service import (
    apply_order_shipping_sync,
    preview_order_shipping_sync,
)
from app.services.order_pricing_service import build_pricing_preview

router = APIRouter(prefix="/api/orders", tags=["orders"])


@router.get("", response_model=dict)
def list_orders(
    status: Optional[OrderStatus] = None,
    entry_method: Optional[OrderEntryMethod] = None,
    payer_name_like: Optional[str] = None,
    campaign: Optional[str] = None,
    source_platform: Optional[str] = None,
    coverage_start: Optional[date] = None,
    coverage_end: Optional[date] = None,
    has_drift: Optional[bool] = None,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Return ``{"rows": [...], "total": N}``.

    ``total`` reflects the DB-side filter result *before* the in-memory
    ``has_drift`` post-filter, so paging metadata stays stable across
    pages of the same query.
    """
    rows, total = order_service.list_orders(
        db,
        status=status,
        entry_method=entry_method,
        payer_name_like=payer_name_like,
        campaign=campaign,
        source_platform=source_platform,
        coverage_start=coverage_start,
        coverage_end=coverage_end,
        has_drift=has_drift,
        skip=skip,
        limit=limit,
    )
    return {"rows": rows, "total": total}


@router.post("/pricing-preview", response_model=PricingPreviewOut)
def preview_pricing(
    data: PricingPreviewIn,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    try:
        return build_pricing_preview(
            db,
            subscription_term=data.subscription_term,
            delivery_method=data.delivery_method,
            term_start_month=data.term_start_month,
            total_quantity=data.total_quantity,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get(
    "/{order_id}/shipping-sync/preview",
    response_model=OrderShippingSyncPreview,
)
def preview_shipping_sync(
    order_id: int,
    issue_number: int = Query(...),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Preview order-generated shipping detail changes for one issue."""
    return preview_order_shipping_sync(db, order_id, issue_number)


@router.post(
    "/{order_id}/shipping-sync/apply",
    response_model=OrderShippingSyncPreview,
)
def apply_shipping_sync(
    order_id: int,
    data: OrderShippingSyncApplyIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Apply order-generated shipping detail changes for one issue."""
    return apply_order_shipping_sync(
        db,
        order_id,
        data.issue_number,
        operator_id=user.id,
    )


@router.get("/{order_id}", response_model=OrderOut)
def get_order(
    order_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Return order with items/allocations/targets all eagerly loaded.

    The per-item ``progress`` field is computed on the fly because it
    depends on the live schedule snapshot — not persisted.
    """
    order = order_service.get_order_detail(db, order_id)
    return _build_order_out(db, order)


@router.post("", response_model=OrderOut, status_code=201)
def create_order(
    data: OrderCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create a draft order with items + v1 allocation + targets."""
    order = order_service.create_order_draft(db, data, created_by=user.id)
    return _build_order_out(db, order)


@router.put("/{order_id}", response_model=OrderOut)
def update_order(
    order_id: int,
    data: OrderUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Patch editable fields. Active orders are restricted to a whitelist."""
    order = order_service.update_order(db, order_id, data, operator_id=user.id)
    # update_order returns the bare Order; re-load with eager fields for the response.
    fresh = order_service.get_order_detail(db, order.id)
    return _build_order_out(db, fresh)


@router.post("/{order_id}/confirm", response_model=OrderOut)
def confirm_order(
    order_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Transition a draft order to active. Idempotent: 409 if already active."""
    order = order_service.confirm_order(db, order_id, operator_id=user.id)
    fresh = order_service.get_order_detail(db, order.id)
    return _build_order_out(db, fresh)


@router.post("/{order_id}/void", response_model=OrderOut)
def void_order(
    order_id: int,
    payload: OrderVoidIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Mark the order void. ``payload.reason`` is required + non-empty."""
    order = order_service.void_order(
        db, order_id, reason=payload.reason, operator_id=user.id
    )
    fresh = order_service.get_order_detail(db, order.id)
    return _build_order_out(db, fresh)


@router.put("/{order_id}/items", response_model=OrderOut)
def update_items(
    order_id: int,
    data: OrderItemsUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Batch update items on an active order with versioned allocation tracking."""
    order = order_service.update_order_items(db, order_id, data, operator_id=user.id)
    fresh = order_service.get_order_detail(db, order.id)
    return _build_order_out(db, fresh)


@router.get("/{order_id}/events", response_model=List[OrderEventOut])
def list_events(
    order_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Return the order's audit trail, newest first."""
    # Force a 404 by going through the detail loader.
    order_service.get_order_detail(db, order_id)
    events = (
        db.query(OrderEvent)
        .filter(OrderEvent.order_id == order_id)
        .order_by(OrderEvent.created_at.desc(), OrderEvent.id.desc())
        .all()
    )
    return events


@router.get(
    "/{order_id}/fulfillment-progress",
    response_model=List[FulfillmentProgress],
)
def get_progress(
    order_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Return one ``FulfillmentProgress`` per order item, in item order."""
    order = order_service.get_order_detail(db, order_id)
    return [
        order_service.compute_fulfillment_progress(db, item)
        for item in order.items
    ]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _build_order_out(db: Session, order) -> OrderOut:
    """Serialise an Order with per-item progress injected.

    Pydantic's ``from_attributes`` mode handles the nested ORM
    traversal for items/allocations/targets/events automatically, but
    the per-item ``progress`` field is computed and has no ORM source —
    we splice it in by building each ``OrderItemOut`` explicitly.
    """
    from app.schemas.order import (
        FulfillmentAllocationOut,
        OrderItemOut,
    )

    item_outs = []
    for item in order.items:
        progress = order_service.compute_fulfillment_progress(db, item)
        allocations = [
            FulfillmentAllocationOut.model_validate(a) for a in item.allocations
        ]
        item_out = OrderItemOut.model_construct(
            id=item.id,
            publication=item.publication,
            publication_format=item.publication_format,
            fulfillment_type=item.fulfillment_type,
            billing_type=item.billing_type,
            subscription_term=item.subscription_term,
            delivery_method=item.delivery_method,
            term_start_month=item.term_start_month,
            coverage_start_date=item.coverage_start_date,
            coverage_end_date=item.coverage_end_date,
            issue_number=item.issue_number,
            issue_label=item.issue_label,
            total_quantity=item.total_quantity,
            unit_price=item.unit_price,
            subtotal=item.subtotal,
            expected_issues_at_creation=item.expected_issues_at_creation,
            status=item.status,
            notes=item.notes,
            allocations=allocations,
            progress=progress,
        )
        item_outs.append(item_out)

    return OrderOut.model_construct(
        id=order.id,
        order_code=order.order_code,
        external_order_no=order.external_order_no,
        order_date=order.order_date,
        entry_method=order.entry_method,
        source_platform=order.source_platform,
        source_store=order.source_store,
        payer_name=order.payer_name,
        payer_contact=order.payer_contact,
        payment_method=order.payment_method,
        payment_collector=order.payment_collector,
        total_amount=order.total_amount,
        paid_amount=order.paid_amount,
        invoice_required=order.invoice_required,
        invoice_title=order.invoice_title,
        invoice_tax_no=order.invoice_tax_no,
        invoice_recipient_email=order.invoice_recipient_email,
        status=order.status,
        notes=order.notes,
        created_at=order.created_at,
        updated_at=order.updated_at,
        items=item_outs,
    )
