"""按正式刊期确认运费转投；目标保留前后版本，现有发货不可静默覆盖。"""
import hashlib
import json
from datetime import date, timedelta
from fastapi import HTTPException
from sqlalchemy import or_, func
from sqlalchemy.orm import Session
from app.models import (Order, OrderItem, FulfillmentAllocation, FulfillmentTarget,
                        OrderStatus, OrderCommercialStatus, Issue, PublicationSchedule)
from app.models.order_item import DeliveryMethod, FulfillmentType, Publication, PublicationFormat, OrderItemStatus
from app.models.fulfillment_target import ShippingChannel, TargetStatus
from app.models.issue import IssueStatus
from app.models.order_source import OrderSource, OrderSourceLink, OrderSourceDeliveryChange
from app.models.postal_delivery import PostalDelivery, PostalDeliverySourceType
from app.models.shipping_detail import ShippingDetail
from app.models.order_event import OrderEventType
from app.schemas.order_source import SourceDeliveryIn, SourceDeliveryUndoIn
from app.services.order_source_service import get_source, bump_version, source_event, target_version, _sql_normalize, normalize
from app.services.order_source_finance_service import finance_state
from app.services.order_event_logger import log_event


def _digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, default=str, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _load(db: Session, source_id: int, link_id: int, version: int | None = None, lock: bool = False) -> tuple[OrderSource, OrderSourceLink, Order, OrderItem, FulfillmentTarget, FulfillmentAllocation]:
    source = get_source(db, source_id, version, lock=lock)
    link = db.query(OrderSourceLink).filter_by(id=link_id, source_id=source_id, active=1).first()
    if source.kind != "shipping_fee" or link is None or link.target_id is None:
        raise HTTPException(409, "请先将运费关联到具体订阅收件目标")
    order = db.query(Order).filter_by(id=link.order_id).populate_existing()
    if lock:
        order = order.with_for_update()
    order = order.one()
    item = db.query(OrderItem).filter_by(id=link.order_item_id).populate_existing().one()
    target = db.query(FulfillmentTarget).filter_by(id=link.target_id).populate_existing().one()
    seen = set()
    while target.replaced_by_target_id is not None:
        if target.id in seen:
            raise HTTPException(409, "目标历史关系异常，请先核对")
        seen.add(target.id)
        target = db.query(FulfillmentTarget).filter_by(id=target.replaced_by_target_id).populate_existing().one()
    allocation = db.get(FulfillmentAllocation, target.allocation_id)
    latest = db.query(func.max(FulfillmentAllocation.version_no)).filter_by(order_item_id=item.id).scalar()
    if (order.status != OrderStatus.active or order.is_historical_archive
            or order.commercial_status in {OrderCommercialStatus.refunded, OrderCommercialStatus.cancelled}):
        raise HTTPException(409, "仅可安排有效且非退款、取消、历史归档的订阅投递")
    if (item.status != OrderItemStatus.active or item.fulfillment_type != FulfillmentType.subscription
            or item.publication != Publication.cbj or item.publication_format != PublicationFormat.paper):
        raise HTTPException(409, "此转投入口适用于中国经营报纸刊订阅")
    if target.status != TargetStatus.active or allocation.version_no != latest or allocation.effective_until_issue is not None:
        raise HTTPException(409, "收件目标已换版，请先重新核对关联")
    if item.coverage_start_date is None or item.coverage_end_date is None:
        raise HTTPException(409, "请先补齐订阅起止日期")
    return source, link, order, item, target, allocation


def _channel(db: Session, item: OrderItem, target: FulfillmentTarget) -> str:
    managed = db.query(OrderSourceDeliveryChange.id).filter(OrderSourceDeliveryChange.status == "applied", or_(
        OrderSourceDeliveryChange.from_target_id == target.id, OrderSourceDeliveryChange.to_target_id == target.id)).first()
    if not managed and item.delivery_method == DeliveryMethod.post_office:
        return "post_office"
    return target.shipping_channel.value


def options(db: Session, source_id: int, link_id: int) -> dict:
    source, link, order, item, target, allocation = _load(db, source_id, link_id)
    rows = db.query(PublicationSchedule).filter(
        PublicationSchedule.issue_number.isnot(None), PublicationSchedule.is_suspended.is_(False),
        PublicationSchedule.publish_date > date.today(),
        PublicationSchedule.publish_date >= item.coverage_start_date,
        PublicationSchedule.publish_date <= item.coverage_end_date).order_by(PublicationSchedule.publish_date).limit(200).all()
    return {"target_id": target.id, "recipient_name": target.recipient_name,
            "shipping_channel": _channel(db, item, target),
            "issues": [{"issue_number": row.issue_number, "publish_date": row.publish_date} for row in rows]}


def _schedule(db: Session, item: OrderItem, issue_number: int, lock: bool = False) -> PublicationSchedule:
    query = db.query(PublicationSchedule).filter_by(issue_number=issue_number).populate_existing()
    if lock:
        query = query.with_for_update()
    schedules = query.all()
    if len(schedules) != 1 or schedules[0].is_suspended:
        raise HTTPException(422, "请从正式刊期选择唯一、非休刊的生效期")
    schedule = schedules[0]
    existing = db.query(Issue).filter_by(issue_number=issue_number).first()
    if existing and existing.publish_date != schedule.publish_date:
        raise HTTPException(409, "刊期日期与正式刊期表冲突，请先核对刊期")
    if schedule.publish_date <= date.today():
        raise HTTPException(409, "已到出刊日的历史不能修改，请选择后续刊期")
    if not item.coverage_start_date <= schedule.publish_date <= item.coverage_end_date:
        raise HTTPException(422, "生效刊期必须在订阅覆盖期内")
    finalized = db.query(Issue.id).filter(Issue.issue_number >= issue_number,
        Issue.publish_date <= item.coverage_end_date, Issue.status != IssueStatus.draft).first()
    if finalized:
        raise HTTPException(409, "影响范围内已有确认报数或导出的刊期，请从尚未确认的后续刊期调整")
    return schedule


def _guard_shipping(db: Session, item: OrderItem, target: FulfillmentTarget, issue_number: int) -> None:
    same_reader = (_sql_normalize(ShippingDetail.name) == normalize(target.recipient_name)) & (
        _sql_normalize(ShippingDetail.address) == normalize(target.recipient_address))
    row = db.query(ShippingDetail.id).filter(ShippingDetail.issue_number >= issue_number,
        or_(ShippingDetail.fulfillment_target_id == target.id,
            (ShippingDetail.order_item_id == item.id) & same_reader,
            ShippingDetail.order_id.is_(None) & same_reader)).first()
    if row:
        raise HTTPException(409, f"生效范围已有发货计划或实发记录 #{row.id}，请先在发货页面核对处理，再重新预览")


def _postal_candidates(db: Session, item: OrderItem, target: FulfillmentTarget,
                       effective_date: date, lock: bool = False) -> list[PostalDelivery]:
    exact_contact = (_sql_normalize(PostalDelivery.recipient_name) == normalize(target.recipient_name)) & (
        _sql_normalize(PostalDelivery.recipient_address) == normalize(target.recipient_address))
    query = db.query(PostalDelivery).filter(PostalDelivery.is_archived.is_(False),
        or_(PostalDelivery.coverage_end_date.is_(None), PostalDelivery.coverage_end_date >= effective_date),
        or_(PostalDelivery.coverage_start_date.is_(None), PostalDelivery.coverage_start_date <= item.coverage_end_date),
        or_(PostalDelivery.fulfillment_target_id == target.id,
            (PostalDelivery.order_item_id == item.id) & exact_contact,
            PostalDelivery.order_id.is_(None) & exact_contact)).order_by(PostalDelivery.id).populate_existing()
    if lock:
        query = query.with_for_update()
    rows = query.limit(101).all()
    if len(rows) > 100:
        raise HTTPException(409, "疑似邮局记录过多，请先在邮局投递台账核对关联")
    return rows


def _postal_state(row: PostalDelivery) -> dict:
    return {"id": row.id, "start": row.coverage_start_date, "end": row.coverage_end_date,
            "archived": row.is_archived, "target_id": row.fulfillment_target_id,
            "order_id": row.order_id, "item_id": row.order_item_id, "updated_at": row.updated_at,
            "name": row.recipient_name, "phone": row.recipient_phone, "address": row.recipient_address,
            "copies": row.copies, "notes": row.notes}


def preview(db: Session, source_id: int, data: SourceDeliveryIn, lock: bool = False) -> dict:
    source, link, order, item, target, allocation = _load(db, source_id, data.link_id, data.version, lock)
    if not data.reason.strip():
        raise HTTPException(422, "请填写转投或更正依据")
    links = db.query(OrderSourceLink).filter_by(source_id=source_id, active=1).all()
    state = finance_state(source, links)
    if data.shipping_channel == "zto_outsource" and (
            not state["allocation_valid"] or state["refund_pending"] or link.amount - (link.refund_amount or 0) <= 0 or not state["net_amount"]
            or state["net_amount"] < 0 or source.commercial_status in {"refunded", "cancelled", "pending_payment"}):
        raise HTTPException(409, "运费已退、未付款或金额待核，请先核对费用；退款记录可继续留档")
    if _channel(db, item, target) == data.shipping_channel:
        raise HTTPException(409, "当前目标已使用该投递方式，无需重复转换")
    schedule = _schedule(db, item, data.effective_from_issue, lock)
    if target.effective_from_issue is not None and data.effective_from_issue <= target.effective_from_issue:
        raise HTTPException(409, "更正应从当前安排之后的刊期生效；尚未执行的安排可使用撤回")
    if target.effective_until_issue is not None and data.effective_from_issue > target.effective_until_issue:
        raise HTTPException(409, "生效期超出当前收件目标范围")
    _guard_shipping(db, item, target, data.effective_from_issue)
    postal = _postal_candidates(db, item, target, schedule.publish_date, lock)
    selected = set(data.postal_delivery_ids)
    required = {row.id for row in postal if row.fulfillment_target_id == target.id}
    if not selected.issubset({row.id for row in postal}):
        raise HTTPException(409, "邮局记录已变化，请重新预览选择")
    selected |= required
    if data.shipping_channel == "post_office" and postal:
        raise HTTPException(409, "覆盖范围存在疑似邮局投递记录，请先核对台账，避免重复起投")
    for row in postal:
        if row.id in selected and (row.coverage_start_date is None or row.coverage_start_date >= schedule.publish_date):
            raise HTTPException(409, f"邮局记录 #{row.id} 尚未开始或缺少起投日，请先撤销未执行名单或补齐记录，再转投")
    evidence = {"version": source.lock_version, "target": target_version(order, item, target),
                "allocation": [allocation.id, allocation.version_no, allocation.effective_from_issue, allocation.effective_until_issue],
                "link": [link.id, link.target_id, link.delivery_from_issue], "issue": [schedule.id, schedule.issue_number, schedule.publish_date],
                "postal": [_postal_state(row) for row in postal], "selected": sorted(selected), "channel": data.shipping_channel}
    return {"expected_state": _digest(evidence), "effective_date": schedule.publish_date,
            "postal_until_date": schedule.publish_date - timedelta(days=1), "order_id": order.id,
            "target_id": target.id, "recipient_name": target.recipient_name,
            "from_channel": _channel(db, item, target), "to_channel": data.shipping_channel,
            "postal_records": [{"id": row.id, "delivery_no": f"{row.year}-{row.delivery_no}",
                "recipient_name": row.recipient_name, "recipient_phone": row.recipient_phone,
                "recipient_address": row.recipient_address, "start": row.coverage_start_date,
                "end": row.coverage_end_date, "required": row.id in required, "selected": row.id in selected} for row in postal],
            "warnings": ["请核对邮局实际停投/起投手续。此操作不向邮局发送指令，也不自动生成中通发货行。",
                         "补拍数量不代表剩余刊期；新安排沿用原订阅份数与截止日。"]}


def apply(db: Session, source_id: int, data: SourceDeliveryIn, operator_id: int | None) -> OrderSource:
    result = preview(db, source_id, data, lock=True)
    if data.expected_state != result["expected_state"]:
        raise HTTPException(409, "转投预览已变化，请重新预览后确认")
    if not data.postal_confirmed:
        raise HTTPException(422, "请先确认邮局停投或起投安排")
    source, link, order, item, target, allocation = _load(db, source_id, data.link_id, data.version, True)
    prior = {"target_until": target.effective_until_issue, "target_replaced_by": target.replaced_by_target_id,
             "link_target_id": link.target_id, "link_delivery_from": link.delivery_from_issue, "postal": []}
    selected = [row["id"] for row in result["postal_records"] if row["selected"]]
    for row in db.query(PostalDelivery).filter(PostalDelivery.id.in_(selected)).all():
        prior["postal"].append({"id": row.id, "end": row.coverage_end_date.isoformat() if row.coverage_end_date else None})
        row.coverage_end_date = result["postal_until_date"]
    prior["target_channel"] = target.shipping_channel.value
    target.shipping_channel = ShippingChannel(result["from_channel"])
    target.effective_until_issue = data.effective_from_issue - 1
    new = FulfillmentTarget(order_item_id=item.id, allocation_id=allocation.id,
        recipient_name=target.recipient_name, recipient_phone=target.recipient_phone,
        recipient_address=target.recipient_address, recipient_postal_code=target.recipient_postal_code,
        quantity=target.quantity, shipping_channel=ShippingChannel(data.shipping_channel),
        distribution_unit_id=None, effective_from_issue=data.effective_from_issue,
        effective_until_issue=prior["target_until"], status=TargetStatus.active,
        notes=f"来源交易 {source.external_order_no} 转投：{data.reason.strip()}")
    db.add(new)
    db.flush()
    target.replaced_by_target_id = new.id
    link.target_id = new.id
    link.delivery_from_issue = data.effective_from_issue if data.shipping_channel == "zto_outsource" else None
    change = OrderSourceDeliveryChange(source_id=source_id, link_id=link.id, from_target_id=target.id,
        to_target_id=new.id, effective_from_issue=data.effective_from_issue, effective_date=result["effective_date"],
        status="applied", previous_state=json.loads(json.dumps(prior, default=str)), reason=data.reason.strip(), created_by=operator_id)
    db.add(change)
    db.flush()
    if data.shipping_channel == "post_office":
        record = PostalDelivery(year=result["effective_date"].year, delivery_no=f"SRC-{source_id}-{change.id}",
            order_id=order.id, order_item_id=item.id, fulfillment_target_id=new.id,
            external_order_no=order.external_order_no, source_type=PostalDeliverySourceType.order_generated,
            recipient_name=new.recipient_name, recipient_phone=new.recipient_phone,
            recipient_address=new.recipient_address, recipient_postal_code=new.recipient_postal_code,
            copies=new.quantity, coverage_start_date=result["effective_date"], coverage_end_date=item.coverage_end_date,
            product="中国经营报", source_channel=order.source_platform, created_by=operator_id,
            notes=f"来源交易 {source.external_order_no} 转投更正；请确认邮局实际起投")
        db.add(record)
        db.flush()
        prior["created_postal_id"] = record.id
    bump_version(db, source, data.version)
    db.flush()
    prior["after_target"] = target_version(order, item, new)
    prior["after_old_target"] = target_version(order, item, target)
    prior["after_postal"] = [_postal_state(row) for row in db.query(PostalDelivery).filter(
        PostalDelivery.id.in_(selected + ([prior["created_postal_id"]] if prior.get("created_postal_id") else []))).all()]
    change.previous_state = json.loads(json.dumps(prior, default=str))
    payload = {"change_id": change.id, "source_id": source_id, "from_target_id": target.id,
               "to_target_id": new.id, "from_channel": result["from_channel"], "to_channel": result["to_channel"],
               "effective_from_issue": data.effective_from_issue, "reason": data.reason.strip(), "postal_confirmed": True}
    source_event(db, source, "delivery_applied", payload, operator_id)
    log_event(db, order.id, OrderEventType.allocation_updated, payload=payload, operator_id=operator_id)
    db.flush()
    return source


def undo(db: Session, source_id: int, data: SourceDeliveryUndoIn, operator_id: int | None, *, apply: bool = False) -> dict:
    source = get_source(db, source_id, data.version, lock=apply)
    change = db.query(OrderSourceDeliveryChange).filter_by(id=data.change_id, source_id=source_id).first()
    if change is None or change.status != "applied":
        raise HTTPException(409, "该转投已撤回或不存在")
    link = db.query(OrderSourceLink).filter_by(id=change.link_id, active=1).first()
    if not link or link.target_id != change.to_target_id:
        raise HTTPException(409, "该关联已有后续更正，不能直接撤回旧安排")
    order = db.query(Order).filter_by(id=link.order_id).with_for_update().one()
    item = db.get(OrderItem, link.order_item_id)
    new = db.get(FulfillmentTarget, change.to_target_id)
    old = db.get(FulfillmentTarget, change.from_target_id)
    _schedule(db, item, change.effective_from_issue, apply)
    _guard_shipping(db, item, new, change.effective_from_issue)
    if not data.reason.strip():
        raise HTTPException(422, "请填写撤回原因")
    if (target_version(order, item, new) != change.previous_state["after_target"] or new.replaced_by_target_id
            or target_version(order, item, old) != change.previous_state["after_old_target"]):
        raise HTTPException(409, "转投后的订阅或目标已修改，请从后续刊期更正")
    postal = db.query(PostalDelivery).filter(PostalDelivery.id.in_(
        [row["id"] for row in change.previous_state["after_postal"]])).all()
    current = json.loads(json.dumps([_postal_state(row) for row in postal], default=str))
    if current != change.previous_state["after_postal"]:
        raise HTTPException(409, "邮局记录已更新，请核对后从后续刊期更正")
    digest = _digest([source.lock_version, change.id, target_version(order, item, new), current])
    if apply:
        if data.expected_state != digest:
            raise HTTPException(409, "撤回预览已变化，请重新核对")
        bump_version(db, source, data.version)
        old.shipping_channel = ShippingChannel(change.previous_state["target_channel"])
        old.effective_until_issue = change.previous_state["target_until"]
        old.replaced_by_target_id = change.previous_state["target_replaced_by"]
        new.status = TargetStatus.suspended
        link.target_id = change.previous_state["link_target_id"]
        link.delivery_from_issue = change.previous_state["link_delivery_from"]
        for state in change.previous_state["postal"]:
            db.get(PostalDelivery, state["id"]).coverage_end_date = date.fromisoformat(state["end"]) if state["end"] else None
        if change.previous_state.get("created_postal_id"):
            db.get(PostalDelivery, change.previous_state["created_postal_id"]).is_archived = True
        change.status = "reverted"
        payload = {"source_id": source_id, "change_id": change.id, "reason": data.reason.strip(), "operation": "delivery_reverted"}
        source_event(db, source, "delivery_reverted", payload, operator_id)
        log_event(db, order.id, OrderEventType.allocation_updated, payload=payload, operator_id=operator_id)
        db.flush()
    return {"expected_state": digest, "change_id": change.id, "message": "撤回尚未执行的转投，恢复之前目标及邮局截止，历史记录保留"}
