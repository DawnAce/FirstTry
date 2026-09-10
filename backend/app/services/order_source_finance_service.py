"""补运费独立计款，订阅原件不再次入账；退款为人工核对的累计额。"""
from datetime import date
from decimal import Decimal
from fastapi import HTTPException
from sqlalchemy import case, func
from sqlalchemy.orm import Session
from app.models import Order
from app.models.order_source import OrderSource, OrderSourceLink
from app.schemas.order_source import SourceRefundIn
from app.services.order_source_service import get_source, bump_version, source_event

ZERO = Decimal("0.00")
REFUND_STATUSES = {"refunded", "partial_refund", "cancelled"}


def finance_state(source: OrderSource, links: list[OrderSourceLink]) -> dict:
    active = [link for link in links if link.active]
    valid = not active or sum((link.amount for link in active), ZERO) == source.paid_amount
    pending = bool(source.finance_review_required) or (source.commercial_status in REFUND_STATUSES and source.verified_refund_amount is None)
    refunded = source.verified_refund_amount or ZERO
    refund_split_valid = not active or refunded == 0 or (
        all(link.refund_amount is not None for link in active)
        and sum((link.refund_amount or ZERO for link in active), ZERO) == refunded
        and all((link.refund_amount or ZERO) <= link.amount for link in active))
    return {"allocation_valid": valid and refund_split_valid, "refund_pending": pending,
            "net_amount": None if pending else source.paid_amount - refunded}


def validate_refund(source: OrderSource, links: list[OrderSourceLink], data: SourceRefundIn) -> dict[int, Decimal]:
    if source.kind != "shipping_fee":
        raise HTTPException(409, "订阅退款请在主订单处理；此处仅核对独立运费")
    if not data.reason.strip():
        raise HTTPException(422, "请填写退款凭据或更正依据")
    if data.amount > source.paid_amount:
        raise HTTPException(422, "累计退款不能超过原付款金额")
    if data.amount > 0 and (data.refunded_at is None or data.refunded_at > date.today()):
        raise HTTPException(422, "请填写实际退款日期，不能晚于今天")
    if data.amount > 0 and source.order_date and data.refunded_at < source.order_date:
        raise HTTPException(422, "退款日期不能早于下单日期")
    if source.commercial_status == "refunded" and data.amount != source.paid_amount:
        raise HTTPException(422, "平台为全额退款，核对金额应等于原付款；源表有误请先更新原件")
    if source.commercial_status == "partial_refund" and not ZERO < data.amount < source.paid_amount:
        raise HTTPException(422, "平台为部分退款，累计退款须大于0且小于原付款")
    active = [link for link in links if link.active]
    if active and sum((link.amount for link in active), ZERO) != source.paid_amount:
        raise HTTPException(409, "来源付款额已变化，请先重新核对关联金额")
    allocations = {row.link_id: row.amount for row in data.allocations}
    if len(allocations) != len(data.allocations):
        raise HTTPException(422, "退款分配不能重复")
    if not allocations and len(active) == 1:
        allocations = {active[0].id: data.amount}
    if not allocations and data.amount == 0:
        allocations = {link.id: ZERO for link in active}
    if set(allocations) != {link.id for link in active}:
        raise HTTPException(422, "请为每个关联目标填写退款分配金额；没有关联时无需分配")
    if active and sum(allocations.values(), ZERO) != data.amount:
        raise HTTPException(422, "分配退款合计必须等于累计退款金额")
    if any(allocations[link.id] > link.amount for link in active):
        raise HTTPException(422, "分配退款不能超过该目标分配的运费")
    return allocations


def verify_refund(db: Session, source_id: int, data: SourceRefundIn, operator_id: int | None,
                  *, apply: bool = False) -> OrderSource:
    source = get_source(db, source_id, data.version, lock=apply)
    links = db.query(OrderSourceLink).filter_by(source_id=source_id, active=1).all()
    allocations = validate_refund(source, links, data)
    if apply:
        previous = {"amount": str(source.verified_refund_amount) if source.verified_refund_amount is not None else None,
                    "date": str(source.verified_refund_date) if source.verified_refund_date else None,
                    "allocations": [{"link_id": link.id, "amount": str(link.refund_amount)} for link in links]}
        bump_version(db, source, data.version)
        source.verified_refund_amount = data.amount
        source.verified_refund_date = data.refunded_at if data.amount else None
        source.finance_note = data.reason.strip()
        source.finance_review_required = False
        for link in links:
            link.refund_amount = allocations[link.id]
        source_event(db, source, "refund_verified", {"previous": previous, **data.model_dump(mode="json")}, operator_id)
        db.flush()
    return source


def finance_summary(db: Session, order_id: int | None = None) -> dict:
    if order_id is None:
        pending = OrderSource.finance_review_required.is_(True) | (OrderSource.commercial_status.in_(REFUND_STATUSES) & OrderSource.verified_refund_amount.is_(None))
        count, paid, refunded, unknown = db.query(func.count(OrderSource.id),
            func.coalesce(func.sum(OrderSource.paid_amount), 0),
            func.coalesce(func.sum(OrderSource.verified_refund_amount), 0),
            func.coalesce(func.sum(case((pending, 1), else_=0)), 0)).filter(OrderSource.kind == "shipping_fee").one()
        return {"fee_count": count, "fee_paid_amount": paid, "fee_refunded_amount": refunded,
                "unresolved_count": unknown, "fee_net_amount": None if unknown else paid - refunded}
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(404, "订单不存在")
    source_ids = db.query(OrderSourceLink.source_id).filter_by(order_id=order_id, active=1)
    sources = db.query(OrderSource).filter(OrderSource.id.in_(source_ids), OrderSource.kind == "shipping_fee").all()
    links = db.query(OrderSourceLink).filter(OrderSourceLink.source_id.in_([s.id for s in sources]),
                                            OrderSourceLink.active == 1).all()
    by_source: dict[int, list[OrderSourceLink]] = {s.id: [] for s in sources}
    for link in links:
        by_source[link.source_id].append(link)
    paid, refunded, unknown = ZERO, ZERO, 0
    for source in sources:
        state = finance_state(source, by_source[source.id])
        if not state["allocation_valid"] or state["refund_pending"]:
            unknown += 1
            continue
        for link in by_source[source.id]:
            if link.order_id == order_id:
                paid += link.amount
                refunded += (link.refund_amount or ZERO) if source.verified_refund_amount else ZERO
    base_paid, base_refund = order.paid_amount or ZERO, order.refunded_amount or ZERO
    return {"fee_count": len(sources), "fee_paid_amount": paid, "fee_refunded_amount": refunded,
            "unresolved_count": unknown, "fee_net_amount": None if unknown else paid - refunded,
            "subscription_paid_amount": base_paid, "subscription_refunded_amount": base_refund,
            "combined_net_amount": None if unknown else base_paid - base_refund + paid - refunded}
