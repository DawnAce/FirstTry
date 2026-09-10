"""有转投历史的订阅按当期生效目标计算，避免邮局与中通重复累计。"""
from datetime import date
from sqlalchemy.orm import Session, selectinload
from app.models import OrderItem, FulfillmentAllocation, FulfillmentTarget, PublicationSchedule
from app.models.fulfillment_target import TargetStatus, ShippingChannel
from app.models.order_item import DeliveryMethod
from app.models.order_source import OrderSourceDeliveryChange
from app.models.shipping_detail import ShippingDetail


def mixed_progresses(db: Session, items: list[OrderItem], as_of: date) -> dict[int, tuple[int, int]]:
    changes = db.query(FulfillmentTarget.order_item_id, OrderSourceDeliveryChange.from_target_id,
                       OrderSourceDeliveryChange.to_target_id).join(
        OrderSourceDeliveryChange, OrderSourceDeliveryChange.to_target_id == FulfillmentTarget.id).filter(
            FulfillmentTarget.order_item_id.in_([item.id for item in items]), OrderSourceDeliveryChange.status == "applied").all()
    ids = {row[0] for row in changes}
    managed = {target_id for row in changes for target_id in (row[1], row[2])}
    if not ids:
        return {}
    allocations = db.query(FulfillmentAllocation).options(selectinload(FulfillmentAllocation.targets)).filter(
        FulfillmentAllocation.order_item_id.in_(ids)).all()
    by_item: dict[int, list[FulfillmentAllocation]] = {id_: [] for id_ in ids}
    for allocation in allocations:
        by_item[allocation.order_item_id].append(allocation)
    rows = db.query(ShippingDetail.order_item_id, ShippingDetail.fulfillment_target_id,
                    ShippingDetail.issue_number, ShippingDetail.shipped_at).filter(
        ShippingDetail.order_item_id.in_(ids), ShippingDetail.complaint_makeup_item_id.is_(None)).all()
    shipped = {(row.fulfillment_target_id, row.issue_number) for row in rows if row.shipped_at is not None}
    schedules = db.query(PublicationSchedule).filter(PublicationSchedule.issue_number.isnot(None),
        PublicationSchedule.is_suspended.is_(False), PublicationSchedule.publish_date <= as_of).all()
    result = {}
    for item in items:
        if item.id not in ids:
            continue
        fulfilled = 0
        for schedule in schedules:
            number = schedule.issue_number
            if not item.coverage_start_date or not item.coverage_end_date or not item.coverage_start_date <= schedule.publish_date <= item.coverage_end_date:
                continue
            applicable = [a for a in by_item[item.id] if (a.effective_from_issue is None or a.effective_from_issue <= number)
                          and (a.effective_until_issue is None or a.effective_until_issue >= number)]
            if not applicable:
                continue
            targets = [t for t in max(applicable, key=lambda a: a.version_no).targets if t.status == TargetStatus.active
                       and (t.effective_from_issue is None or t.effective_from_issue <= number)
                       and (t.effective_until_issue is None or t.effective_until_issue >= number)]
            if targets and all(t.shipping_channel == ShippingChannel.post_office or (
                    item.delivery_method == DeliveryMethod.post_office and t.id not in managed) or (
                    t.shipping_channel == ShippingChannel.zto_outsource and (t.id, number) in shipped) for t in targets):
                fulfilled += 1
        result[item.id] = (sum(row.order_item_id == item.id for row in rows), fulfilled)
    return result


def has_delivery_history(db: Session, item_ids: list[int]) -> bool:
    return db.query(OrderSourceDeliveryChange.id).join(
        FulfillmentTarget, FulfillmentTarget.id == OrderSourceDeliveryChange.to_target_id).filter(
            FulfillmentTarget.order_item_id.in_(item_ids), OrderSourceDeliveryChange.status == "applied").first() is not None


def postal_target_clause():
    """历史 postal 明细的目标可能保留旧默认 zto；只有明确转投目标按渠道排除。"""
    from sqlalchemy import or_, select
    managed = select(OrderSourceDeliveryChange.id).where(OrderSourceDeliveryChange.status == "applied",
        or_(OrderSourceDeliveryChange.from_target_id == FulfillmentTarget.id,
            OrderSourceDeliveryChange.to_target_id == FulfillmentTarget.id)).exists()
    return or_(FulfillmentTarget.shipping_channel == ShippingChannel.post_office, ~managed)
