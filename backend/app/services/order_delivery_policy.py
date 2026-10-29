"""订单各期实际投递的共同口径；历史默认中通不构成转投依据。"""
from collections.abc import Iterable
from datetime import date

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import FulfillmentTarget, Order, OrderItem, PublicationSchedule
from app.models.fulfillment_target import ShippingChannel
from app.models.order_item import DeliveryMethod
from app.models.order_source import OrderSource, OrderSourceDeliveryChange
from app.models.order_item import Publication, PublicationFormat


def managed_target_ids(db: Session, item_ids: Iterable[int]) -> set[int]:
    ids = list(item_ids)
    if not ids:
        return set()
    changes = db.query(OrderSourceDeliveryChange.from_target_id, OrderSourceDeliveryChange.to_target_id).join(
        FulfillmentTarget, FulfillmentTarget.id == OrderSourceDeliveryChange.to_target_id).filter(
        FulfillmentTarget.order_item_id.in_(ids), OrderSourceDeliveryChange.status == "applied").all()
    return {target for row in changes for target in row}


def target_channel(item: OrderItem, target: FulfillmentTarget, managed: set[int]) -> ShippingChannel:
    if item.delivery_method == DeliveryMethod.post_office and target.id not in managed:
        return ShippingChannel.post_office
    return ShippingChannel(target.shipping_channel)


def fee_arrangement_available(source: OrderSource) -> bool:
    """关联会清除旧退款分配，须先保留费用归属，再核对退款后单独更正投递。"""
    return (source.commercial_status in {"paid", "shipped"}
            and not source.finance_review_required and source.paid_amount > 0
            and not source.verified_refund_amount)


def postal_target_clause():
    """SQL 与 target_channel 保持一致，避免查询列表后再逐行过滤。"""
    managed = select(OrderSourceDeliveryChange.id).where(OrderSourceDeliveryChange.status == "applied",
        or_(OrderSourceDeliveryChange.from_target_id == FulfillmentTarget.id,
            OrderSourceDeliveryChange.to_target_id == FulfillmentTarget.id)).exists()
    return or_(FulfillmentTarget.shipping_channel == ShippingChannel.post_office, ~managed)


def candidate_options(db: Session, values: list[tuple[Order, OrderItem, FulfillmentTarget]]) -> dict[int, dict]:
    """一次读取候选订期内刊期；key 使用对象身份，也支持未入库的导入目标。"""
    eligible = [(order, item, target) for order, item, target in values
        if item.publication == Publication.cbj and item.publication_format == PublicationFormat.paper
        and item.fulfillment_type == "subscription" and item.status == "active" and order.status == "active"
        and target.status == "active" and target.replaced_by_target_id is None
        and item.coverage_start_date and item.coverage_end_date and not order.is_historical_archive
        and order.commercial_status not in {"refunded", "cancelled"}]
    if not eligible:
        return {}
    managed = managed_target_ids(db, [item.id for _, item, _ in eligible if item.id is not None])
    from app.models import FulfillmentAllocation
    allocation_ids = {target.allocation_id for _, _, target in eligible if target.allocation_id is not None}
    closed_allocations = {row.id for row in db.query(FulfillmentAllocation.id).filter(
        FulfillmentAllocation.id.in_(allocation_ids), FulfillmentAllocation.effective_until_issue.isnot(None)).all()} if allocation_ids else set()
    schedules = db.query(PublicationSchedule).filter(PublicationSchedule.issue_number.isnot(None),
        PublicationSchedule.is_suspended.is_(False),
        PublicationSchedule.publish_date >= min(item.coverage_start_date for _, item, _ in eligible),
        PublicationSchedule.publish_date <= max(item.coverage_end_date for _, item, _ in eligible)).order_by(
        PublicationSchedule.publish_date).all()
    result = {}
    for _, item, target in eligible:
        if target.allocation_id in closed_allocations or target_channel(item, target, managed) != ShippingChannel.post_office:
            continue
        rows = [row for row in schedules if item.coverage_start_date <= row.publish_date <= item.coverage_end_date]
        if not rows:
            continue
        result[id(target)] = {"full_period_issue": rows[0].issue_number,
            "full_period_available": rows[0].publish_date > date.today()
                and (target.effective_from_issue is None or rows[0].issue_number >= target.effective_from_issue)
                and (target.effective_until_issue is None or rows[0].issue_number <= target.effective_until_issue),
            "issues": [{"issue_number": row.issue_number, "publish_date": row.publish_date.isoformat()}
                       for row in rows if row.publish_date > date.today()
                       and (target.effective_from_issue is None or row.issue_number >= target.effective_from_issue)
                       and (target.effective_until_issue is None or row.issue_number <= target.effective_until_issue)]}
    return result


def item_segments(db: Session, items: list[OrderItem], managed: set[int]) -> dict[int, list[dict]]:
    dated = [item for item in items if item.publication == Publication.cbj
             and item.publication_format == PublicationFormat.paper
             and item.coverage_start_date and item.coverage_end_date]
    if not dated:
        return {}
    schedules = db.query(PublicationSchedule).filter(PublicationSchedule.issue_number.isnot(None),
        PublicationSchedule.is_suspended.is_(False),
        PublicationSchedule.publish_date >= min(item.coverage_start_date for item in dated),
        PublicationSchedule.publish_date <= max(item.coverage_end_date for item in dated)).order_by(
        PublicationSchedule.publish_date).all()
    result = {}
    for item in dated:
        segments = {}
        for schedule in schedules:
            number = schedule.issue_number
            if not item.coverage_start_date <= schedule.publish_date <= item.coverage_end_date:
                continue
            allocations = [a for a in item.allocations if (a.effective_from_issue is None or a.effective_from_issue <= number)
                           and (a.effective_until_issue is None or number <= a.effective_until_issue)]
            if not allocations:
                continue
            allocation = max(allocations, key=lambda a: a.version_no)
            for target in allocation.targets:
                if (target.status != "active" or (target.effective_from_issue is not None and number < target.effective_from_issue)
                        or (target.effective_until_issue is not None and number > target.effective_until_issue)):
                    continue
                if target.id not in segments:
                    segments[target.id] = {"target_id": target.id, "shipping_channel": target_channel(item, target, managed).value,
                        "from_issue": number, "until_issue": number, "start_date": schedule.publish_date,
                        "end_date": schedule.publish_date}
                segments[target.id]["until_issue"] = number
                segments[target.id]["end_date"] = schedule.publish_date
        result[item.id] = list(segments.values())
    return result
