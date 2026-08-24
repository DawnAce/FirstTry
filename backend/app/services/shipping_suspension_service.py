"""Keep plan stop status and no-shipment attribution in one business chain."""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Issue, ShippingDetail, ShippingFulfillmentAdjustment
from app.models.shipping_deferral import ShippingDeferral
from app.models.user import User
from app.services.operation_log_service import record_operation


PLAN_STATUS_ADJUSTMENT_SOURCE = "plan_status"
MANUAL_ADJUSTMENT_SOURCE = "manual"
NO_SHIPMENT_REQUIRED = "no_shipment_required"
WAREHOUSE_STOCK_IN = "warehouse_stock_in"
DEFAULT_PLAN_STOP_REASON = "客户要求暂停本期发货"


def _record_adjustment_operation(
    db: Session,
    *,
    user: User | None,
    adjustment: ShippingFulfillmentAdjustment,
    action: str,
    changes: dict[str, object],
) -> None:
    record_operation(
        db,
        user=user,
        username="系统自动联动" if user is None else None,
        table_name="shipping_fulfillment_adjustments",
        record_id=adjustment.id,
        record_name=adjustment.reason,
        action=action,
        issue_number=adjustment.issue_number,
        changes=changes,
    )


def _apply_detail_snapshot(
    adjustment: ShippingFulfillmentAdjustment,
    detail: ShippingDetail,
) -> None:
    adjustment.shipping_detail_id = detail.id
    adjustment.detail_name_snapshot = detail.name
    adjustment.detail_phone_snapshot = detail.phone
    adjustment.detail_address_snapshot = detail.address
    adjustment.detail_channel_snapshot = detail.channel
    adjustment.detail_company_snapshot = detail.company
    adjustment.detail_quantity_snapshot = detail.quantity


def _delete_adjustment(
    db: Session,
    *,
    adjustment: ShippingFulfillmentAdjustment,
    user: User | None,
) -> None:
    changes = {
        "adjustment_type": adjustment.adjustment_type,
        "source": adjustment.source,
        "quantity": adjustment.quantity,
        "reason": adjustment.reason,
        "shipping_detail_id": adjustment.shipping_detail_id,
    }
    _record_adjustment_operation(
        db,
        user=user,
        adjustment=adjustment,
        action="delete_plan_stop_adjustment",
        changes=changes,
    )
    db.delete(adjustment)


def delete_plan_status_adjustments(
    db: Session,
    *,
    detail: ShippingDetail,
    user: User | None,
) -> int:
    """Remove only adjustments owned by the plan-status synchronizer."""
    adjustments = (
        db.query(ShippingFulfillmentAdjustment)
        .filter(
            ShippingFulfillmentAdjustment.shipping_detail_id == detail.id,
            ShippingFulfillmentAdjustment.source == PLAN_STATUS_ADJUSTMENT_SOURCE,
        )
        .order_by(ShippingFulfillmentAdjustment.id)
        .all()
    )
    for adjustment in adjustments:
        _delete_adjustment(db, adjustment=adjustment, user=user)
    return len(adjustments)


def sync_plan_status_adjustment(
    db: Session,
    *,
    detail: ShippingDetail,
    user: User | None,
) -> None:
    """Create, resize, or remove the no-shipment attribution for a stopped row."""
    if detail.id is None:
        db.flush()

    automatic = (
        db.query(ShippingFulfillmentAdjustment)
        .filter(
            ShippingFulfillmentAdjustment.shipping_detail_id == detail.id,
            ShippingFulfillmentAdjustment.source == PLAN_STATUS_ADJUSTMENT_SOURCE,
        )
        .order_by(ShippingFulfillmentAdjustment.id)
        .all()
    )
    if detail.status != "停发":
        for adjustment in automatic:
            _delete_adjustment(db, adjustment=adjustment, user=user)
        return

    issue = db.query(Issue).filter(Issue.issue_number == detail.issue_number).first()
    if not issue:
        raise HTTPException(status_code=409, detail=f"第 {detail.issue_number} 期不存在，不能登记停发归因")
    if (detail.quantity or 0) <= 0:
        raise HTTPException(status_code=400, detail="0份记录不能设为停发，请直接删除")
    other_adjustments = (
        db.query(ShippingFulfillmentAdjustment)
        .filter(
            ShippingFulfillmentAdjustment.shipping_detail_id == detail.id,
            ShippingFulfillmentAdjustment.source != PLAN_STATUS_ADJUSTMENT_SOURCE,
        )
        .all()
    )
    if any(item.adjustment_type == WAREHOUSE_STOCK_IN for item in other_adjustments):
        raise HTTPException(status_code=409, detail="该明细已登记转库留存，不能再设为停发")
    manual_no_shipment_quantity = sum(
        max(item.quantity or 0, 0)
        for item in other_adjustments
        if item.adjustment_type == NO_SHIPMENT_REQUIRED
    )
    automatic_quantity = max((detail.quantity or 0) - manual_no_shipment_quantity, 0)

    # “无需运单”在核销中会直接计为已发出。用户随后明确把整条计划
    # 改为停发时，新的业务决定优先，避免同一份同时算作已发和无需发货。
    if detail.shipping_requirement == "no_tracking_required":
        detail.shipping_requirement = "tracking_required"

    if detail.physical_shipped_quantity > 0:
        raise HTTPException(status_code=409, detail="该明细已经实际发出，不能再将整条计划设为停发")

    active_deferral_count = db.query(ShippingDeferral).filter(
        ShippingDeferral.shipping_detail_id == detail.id,
        ShippingDeferral.status == "pending",
    ).count()
    if active_deferral_count:
        raise HTTPException(status_code=409, detail="该明细存在待合寄记录，请先撤销合寄再设为停发")

    if automatic_quantity == 0:
        for adjustment in automatic:
            _delete_adjustment(db, adjustment=adjustment, user=user)
        return

    adjustment = automatic[0] if automatic else ShippingFulfillmentAdjustment(
        issue_id=issue.id,
        issue_number=issue.issue_number,
        adjustment_type=NO_SHIPMENT_REQUIRED,
        source=PLAN_STATUS_ADJUSTMENT_SOURCE,
        quantity=automatic_quantity,
        reason=DEFAULT_PLAN_STOP_REASON,
        created_by=getattr(user, "id", None),
    )
    if not automatic:
        db.add(adjustment)
        _apply_detail_snapshot(adjustment, detail)
        db.flush()
        _record_adjustment_operation(
            db,
            user=user,
            adjustment=adjustment,
            action="create_plan_stop_adjustment",
            changes={
                "adjustment_type": adjustment.adjustment_type,
                "source": adjustment.source,
                "quantity": adjustment.quantity,
                "reason": adjustment.reason,
                "shipping_detail_id": adjustment.shipping_detail_id,
            },
        )
    else:
        old_quantity = adjustment.quantity
        old_snapshot = {
            "detail_name_snapshot": adjustment.detail_name_snapshot,
            "detail_phone_snapshot": adjustment.detail_phone_snapshot,
            "detail_address_snapshot": adjustment.detail_address_snapshot,
            "detail_channel_snapshot": adjustment.detail_channel_snapshot,
            "detail_company_snapshot": adjustment.detail_company_snapshot,
            "detail_quantity_snapshot": adjustment.detail_quantity_snapshot,
        }
        adjustment.quantity = automatic_quantity
        adjustment.reason = DEFAULT_PLAN_STOP_REASON
        _apply_detail_snapshot(adjustment, detail)
        new_snapshot = {
            "detail_name_snapshot": adjustment.detail_name_snapshot,
            "detail_phone_snapshot": adjustment.detail_phone_snapshot,
            "detail_address_snapshot": adjustment.detail_address_snapshot,
            "detail_channel_snapshot": adjustment.detail_channel_snapshot,
            "detail_company_snapshot": adjustment.detail_company_snapshot,
            "detail_quantity_snapshot": adjustment.detail_quantity_snapshot,
        }
        if old_quantity != automatic_quantity or old_snapshot != new_snapshot:
            _record_adjustment_operation(
                db,
                user=user,
                adjustment=adjustment,
                action="update_plan_stop_adjustment",
                changes={
                    "quantity": {"old": old_quantity, "new": automatic_quantity},
                    "detail_snapshot_updated": old_snapshot != new_snapshot,
                },
            )

    for duplicate in automatic[1:]:
        _delete_adjustment(db, adjustment=duplicate, user=user)
