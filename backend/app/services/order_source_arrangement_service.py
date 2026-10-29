"""一次确认运费归属与投递范围；调用入口负责提交/回滚整个事务。"""
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import OrderItem
from app.models.order_source import OrderSource, OrderSourceLink
from app.schemas.order_source import SourceLinkIn, SourceDeliveryIn, DeliveryArrangementIn
from app.services import order_source_delivery_service as delivery
from app.services.order_source_service import get_source, validate_links, link_source


def delivery_request(db: Session, source: OrderSource, link: OrderSourceLink,
                     plan: DeliveryArrangementIn, reason: str, item: OrderItem) -> SourceDeliveryIn:
    number = delivery.first_issue(db, item).issue_number if plan.scope == "full_period" else plan.effective_from_issue
    if number is None:
        raise HTTPException(422, "中途改中通请填写正式起始期号")
    return SourceDeliveryIn(version=source.lock_version, reason=reason, link_id=link.id or 0,
        effective_from_issue=number, shipping_channel="zto_outsource", scope=plan.scope,
        postal_delivery_ids=plan.postal_delivery_ids, postal_confirmed=plan.postal_confirmed,
        expected_state=plan.expected_state)


def preview_links(db: Session, source_id: int, data: SourceLinkIn, *, lock: bool = False) -> dict:
    source = get_source(db, source_id, data.version, lock=lock)
    result = validate_links(db, source, data, lock=lock)
    # 与 link_source 实际保存一致：重新分配后旧退款归属须重新核对。
    virtual = [OrderSourceLink(source_id=source_id, order_id=row.order_id, order_item_id=row.order_item_id,
        target_id=row.target_id, amount=row.amount, active=1,
        refund_amount=None)
        for row in data.allocations]
    allocations = []
    reviews = []
    for allocation, link in zip(data.allocations, virtual):
        value = allocation.model_copy(deep=True)
        if value.delivery is not None:
            context = delivery._load(db, source_id, 0, data.version, lock, proposed_link=link)
            request = delivery_request(db, source, link, value.delivery, data.reason, context[3])
            review = delivery.preview(db, source_id, request, lock, context=context, links_override=virtual)
            if lock and (not value.delivery.postal_confirmed or value.delivery.expected_state != review["expected_state"]):
                raise HTTPException(409, "投递范围或关联预览已变化，请重新预览并核对邮局安排")
            value.delivery.expected_state = review["expected_state"]
            reviews.append(review)
        allocations.append(value)
    result.update(allocations=allocations, delivery_previews=reviews)
    if reviews:
        result["warnings"] = ["确认后同时保存运费关联与投递范围，原订期、份数和订阅价保持原记录。"]
    return result


def save_links(db: Session, source_id: int, data: SourceLinkIn, operator_id: int | None) -> OrderSource:
    preview_links(db, source_id, data, lock=True)
    source = link_source(db, source_id, data, operator_id)
    links = {row.target_id: row for row in db.query(OrderSourceLink).filter_by(source_id=source_id, active=1).all()}
    for allocation in data.allocations:
        if allocation.delivery is None:
            continue
        link = links[allocation.target_id]
        context = delivery._load(db, source_id, link.id, source.lock_version, True)
        request = delivery_request(db, source, link, allocation.delivery, data.reason, context[3])
        request.expected_state = delivery.preview(db, source_id, request, True)["expected_state"]
        delivery.apply(db, source_id, request, operator_id)
    return source
