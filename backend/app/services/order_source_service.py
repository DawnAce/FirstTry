"""原始交易留存及归属。写操作由调用入口统一提交。"""
import hashlib
import json
import re
from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import and_, or_, select, func
from sqlalchemy.orm import Session

from app.models import Order, OrderCommercialStatus
from app.models.order_source import OrderSource, OrderSourceEvent, OrderSourceLink, OrderSourceVersion
from app.services.cbj_order_import_parser import ParsedOrder
from app.services.order_import_status_service import map_commercial_status
from app.models import OrderItem, FulfillmentAllocation, FulfillmentTarget, OrderStatus
from app.models.order_item import FulfillmentType, OrderItemStatus, Publication
from app.models.fulfillment_target import TargetStatus
from app.schemas.order_source import SourceLinkIn


def normalize(value: str | None) -> str:
    """仅去空白及常见分隔符，保留门牌号和有意义字符。"""
    return re.sub(r"[\s，,。；;：:（）()\-]+", "", value or "").casefold()


def source_snapshot(po: ParsedOrder, platform: str, store: str | None, filename: str | None) -> dict:
    return {
        "platform": platform, "store": store or "", "external_order_no": po.external_order_no,
        "order_date": po.order_date.isoformat() if po.order_date else None,
        "payment_time": po.payment_time.isoformat() if po.payment_time else None,
        "paid_amount": str(po.paid_amount.quantize(Decimal("0.01"))),
        "original_amount": str(po.original_amount.quantize(Decimal("0.01"))),
        "status_raw": po.status_raw, "commercial_status": map_commercial_status(po.status_raw).status.value,
        "recipient_name": po.recipient_name, "recipient_phone": po.recipient_phone,
        "recipient_address": po.recipient_address, "recipient_postal_code": po.recipient_postal_code,
        "notes": po.notes, "payment_method": po.payment_method_raw, "invoice": po.invoice_raw,
        "product_lines": [{"raw": p.raw, "name": p.name, "quantity": p.quantity,
                           "unit_price": str(p.unit_price), "is_shipping": p.is_shipping,
                           "mentions_zto": p.mentions_zto} for p in po.product_lines],
        "filename": filename, "source_sheet": po.source_sheet, "source_row": po.source_row,
        "raw_cells": po.raw_cells,
    }


def fingerprint(snapshot: dict) -> str:
    content = {k: v for k, v in snapshot.items() if k not in {"filename", "source_sheet", "source_row"}}
    return hashlib.sha256(json.dumps(content, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def identity_query(db: Session, snapshot: dict):
    return db.query(OrderSource).filter(
        OrderSource.platform == snapshot["platform"], OrderSource.store == snapshot["store"],
        OrderSource.external_order_no == snapshot["external_order_no"])


def source_event(db: Session, source: OrderSource, action: str, payload: dict, operator_id: int | None) -> None:
    db.add(OrderSourceEvent(source_id=source.id, action=action, payload=payload, operator_id=operator_id))


def validate_import_sources(db: Session, records: list[dict], confirmed: list[str]) -> None:
    for record in records:
        snapshot = record["snapshot"]
        current = identity_query(db, snapshot).with_for_update().first()
        expected = record["expected_revision"]
        if expected is not None and (current is None or current.lock_version != expected):
            raise HTTPException(409, "来源交易已变化，请重新预览后确认")
        if record["decision"] == "source_update" and snapshot["external_order_no"] not in confirmed:
            raise HTTPException(409, "来源交易有变化，请逐笔核对并确认更新")
        if expected is None and current is not None:
            version = db.query(OrderSourceVersion).filter_by(source_id=current.id, revision=current.revision).one()
            if version.fingerprint != fingerprint(snapshot):
                raise HTTPException(409, "来源交易已被另一次导入，请重新预览")


def save_import_source(db: Session, record: dict, order: Order | None, operator_id: int | None) -> tuple[OrderSource, bool]:
    snapshot = record["snapshot"]
    source = identity_query(db, snapshot).first()
    digest = fingerprint(snapshot)
    if source is not None:
        version = db.query(OrderSourceVersion).filter_by(source_id=source.id, revision=source.revision).one()
        if version.fingerprint == digest:
            return source, False
        source.revision += 1
        source.lock_version += 1
        # 原始状态更新不等于退款流水确认，也不回写订阅履约或财务。
        source.verified_refund_amount = None
        source.verified_refund_date = None
    else:
        source = OrderSource(platform=snapshot["platform"], store=snapshot["store"],
                             external_order_no=snapshot["external_order_no"], kind=record["kind"],
                             revision=1, created_by=operator_id)
        db.add(source)
    source.order_date = date.fromisoformat(snapshot["order_date"]) if snapshot["order_date"] else None
    source.recipient_name = normalize(snapshot["recipient_name"])
    source.recipient_phone = normalize(snapshot["recipient_phone"])
    source.recipient_address = normalize(snapshot["recipient_address"])
    source.paid_amount = Decimal(snapshot["paid_amount"])
    source.commercial_status = snapshot["commercial_status"]
    db.flush()
    db.add(OrderSourceVersion(source_id=source.id, revision=source.revision, fingerprint=digest,
                              snapshot=snapshot, search_text=normalize(json.dumps(snapshot, ensure_ascii=False)),
                              created_by=operator_id))
    if order is not None and source.revision == 1:
        db.add(OrderSourceLink(source_id=source.id, order_id=order.id, amount=source.paid_amount,
                               active=1, reason="原始订阅交易", created_by=operator_id))
    source_event(db, source, "imported" if source.revision == 1 else "source_updated",
                 {"revision": source.revision, "kind": source.kind}, operator_id)
    return source, True


def source_search_ids(term: str):
    # 子查询在分页前执行；历史版本同样可被检索，主列表不因多个命中而重复。
    return select(OrderSourceVersion.source_id).where(
        OrderSourceVersion.search_text.contains(normalize(term), autoescape=True))


def source_order_ids(term: str):
    return select(OrderSourceLink.order_id).where(
        OrderSourceLink.active == 1, OrderSourceLink.source_id.in_(source_search_ids(term)))


def get_source(db: Session, source_id: int, version: int | None = None, lock: bool = False) -> OrderSource:
    query = db.query(OrderSource).filter(OrderSource.id == source_id).populate_existing()
    if lock:
        query = query.with_for_update()
    source = query.first()
    if source is None:
        raise HTTPException(404, "来源交易不存在")
    if version is not None and source.lock_version != version:
        raise HTTPException(409, "来源或关联已变化，请刷新后重新核对")
    return source


def bump_version(db: Session, source: OrderSource, expected: int) -> None:
    changed = db.query(OrderSource).filter_by(id=source.id, lock_version=expected).update(
        {"lock_version": expected + 1}, synchronize_session=False)
    if changed != 1:
        raise HTTPException(409, "来源交易已被其他操作修改，请刷新")
    db.refresh(source)


def target_version(order: Order, item: OrderItem, target: FulfillmentTarget) -> str:
    state = [order.id, order.status, order.commercial_status, order.updated_at, item.id,
             item.updated_at, item.status, item.coverage_start_date, item.coverage_end_date,
             item.delivery_method, item.total_quantity, target.id, target.allocation_id,
             target.status, target.quantity, target.recipient_name, target.recipient_phone,
             target.recipient_address, target.shipping_channel, target.effective_from_issue,
             target.effective_until_issue, target.updated_at]
    return hashlib.sha256(json.dumps(state, default=str, ensure_ascii=False).encode()).hexdigest()


def _sql_normalize(column):
    result = func.lower(func.coalesce(column, ""))
    for char in " \t\r\n　，,。；;：:（）()-":
        result = func.replace(result, char, "")
    return result


def candidates(db: Session, source_id: int, search: str | None = None) -> dict:
    source = get_source(db, source_id)
    snapshot = db.query(OrderSourceVersion).filter_by(source_id=source.id, revision=source.revision).one().snapshot
    latest = db.query(FulfillmentAllocation.order_item_id.label("item_id"),
                      func.max(FulfillmentAllocation.version_no).label("version"))
    latest = latest.group_by(FulfillmentAllocation.order_item_id).subquery()
    query = db.query(Order, OrderItem, FulfillmentTarget).join(OrderItem, OrderItem.order_id == Order.id)
    query = query.join(FulfillmentAllocation, FulfillmentAllocation.order_item_id == OrderItem.id).join(
        latest, and_(latest.c.item_id == OrderItem.id, latest.c.version == FulfillmentAllocation.version_no))
    query = query.join(FulfillmentTarget, FulfillmentTarget.allocation_id == FulfillmentAllocation.id).filter(
        OrderItem.fulfillment_type == FulfillmentType.subscription, OrderItem.status == OrderItemStatus.active,
        FulfillmentTarget.status == TargetStatus.active, Order.status == OrderStatus.active)
    fields = [("姓名", FulfillmentTarget.recipient_name, source.recipient_name),
              ("电话", FulfillmentTarget.recipient_phone, source.recipient_phone),
              ("地址", FulfillmentTarget.recipient_address, source.recipient_address)]
    exact = [and_(value != "", _sql_normalize(column) == value) for _, column, value in fields]
    if search and search.strip():
        term = normalize(search)
        query = query.filter(or_(Order.id.in_(source_order_ids(search)),
            *[_sql_normalize(col).contains(term, autoescape=True) for col in (
                Order.order_code, Order.external_order_no, FulfillmentTarget.recipient_name,
                FulfillmentTarget.recipient_phone, FulfillmentTarget.recipient_address)]))
    else:
        query = query.filter(or_(*exact))
    product_names = " ".join(line["name"] for line in snapshot["product_lines"])
    if "中国经营报" in product_names:
        query = query.filter(OrderItem.publication == Publication.cbj)
    elif "商学院" in product_names:
        query = query.filter(OrderItem.publication == Publication.business_school)
    # 全匹配与覆盖期排在最近下单之前，数据库先限定候选范围。
    full_match = and_(*exact)
    covering = and_(OrderItem.coverage_start_date <= source.order_date,
                    OrderItem.coverage_end_date >= source.order_date) if source.order_date else False
    prior = Order.order_date <= source.order_date if source.order_date else False
    from sqlalchemy import case
    query = query.order_by(case((full_match, 1), else_=0).desc(),
                          case((covering, 1), else_=0).desc(), case((prior, 1), else_=0).desc(),
                          Order.order_date.desc(), Order.id.desc(), FulfillmentTarget.id)
    values = query.limit(101).all()
    rows = []
    high = []
    for order, item, target in values[:100]:
        matches = [bool(value) and normalize(getattr(target, field)) == value for field, value in (
            ("recipient_name", source.recipient_name), ("recipient_phone", source.recipient_phone),
            ("recipient_address", source.recipient_address))]
        evidence = [f"{label}一致" if matched else f"{label}不同或缺失"
                    for label, matched in zip(("姓名", "电话", "地址"), matches)]
        covered = bool(source.order_date and item.coverage_start_date and item.coverage_end_date
                       and item.coverage_start_date <= source.order_date <= item.coverage_end_date)
        before = bool(source.order_date and order.order_date <= source.order_date)
        evidence += ["补费日期在订期内" if covered else "订期不覆盖补费日期或尚未补齐",
                     "订阅早于或同日补费" if before else "订阅晚于补费或日期缺失"]
        if order.commercial_status in {OrderCommercialStatus.refunded, OrderCommercialStatus.cancelled}:
            evidence.append("主订阅已退款或取消，仅供历史核对")
        row = {"order_id": order.id, "order_code": order.order_code, "external_order_no": order.external_order_no,
               "order_date": order.order_date, "order_item_id": item.id, "target_id": target.id,
               "publication": item.publication.value, "recipient_name": target.recipient_name,
               "recipient_phone": target.recipient_phone, "recipient_address": target.recipient_address,
               "coverage_start_date": item.coverage_start_date, "coverage_end_date": item.coverage_end_date,
               "confidence": "possible", "evidence": evidence,
               "expected_target_version": target_version(order, item, target)}
        rows.append(row)
        if all(matches) and covered and before and order.commercial_status not in {
                OrderCommercialStatus.refunded, OrderCommercialStatus.cancelled}:
            high.append(row)
    if len(high) == 1 and len(values) <= 100:
        high[0]["confidence"] = "high"
    return {"rows": rows, "truncated": len(values) > 100}


def validate_links(db: Session, source: OrderSource, data: SourceLinkIn, lock: bool = False) -> dict:
    if not data.reason.strip():
        raise HTTPException(422, "请填写关联或更正原因")
    if source.kind != "shipping_fee":
        raise HTTPException(409, "此入口用于运费关联，原订阅来源不能改为补费")
    active = db.query(OrderSourceLink).filter_by(source_id=source.id, active=1).all()
    if any(link.delivery_from_issue is not None for link in active):
        raise HTTPException(409, "关联已用于投递变更，请先完成投递更正核对，不能直接改挂或解除")
    keys = [(a.order_id, a.order_item_id, a.target_id) for a in data.allocations]
    if len(set(keys)) != len(keys):
        raise HTTPException(422, "同一订阅收件目标不能重复分配")
    total = sum((a.amount for a in data.allocations), Decimal("0"))
    if data.allocations and total != source.paid_amount:
        raise HTTPException(422, "分配金额合计必须等于原始付款金额（退款另行核对）")
    for allocation in data.allocations:
        query = db.query(Order, OrderItem, FulfillmentTarget).join(OrderItem, OrderItem.order_id == Order.id).join(
            FulfillmentTarget, FulfillmentTarget.order_item_id == OrderItem.id).filter(
                Order.id == allocation.order_id, OrderItem.id == allocation.order_item_id,
                FulfillmentTarget.id == allocation.target_id)
        if lock:
            query = query.with_for_update()
        value = query.populate_existing().first()
        if value is None:
            raise HTTPException(422, "订单、订阅明细与收件目标不匹配")
        order, item, target = value
        if target_version(order, item, target) != allocation.expected_target_version:
            raise HTTPException(409, "订阅或收件信息已变化，请重新选择候选并核对")
        if order.status != OrderStatus.active:
            raise HTTPException(409, "订单已作废或尚未确认，请重新核对")
        if item.fulfillment_type != FulfillmentType.subscription or item.status != OrderItemStatus.active:
            raise HTTPException(409, "只能关联有效订阅明细")
        latest = db.query(func.max(FulfillmentAllocation.version_no)).filter_by(order_item_id=item.id).scalar()
        target_allocation = db.get(FulfillmentAllocation, target.allocation_id)
        if target.status != TargetStatus.active or target_allocation.version_no != latest:
            raise HTTPException(409, "收件目标已经更换，请重新选择")
    return {"can_apply": True, "total_amount": total, "allocations": data.allocations,
            "warnings": ["本次只更新来源归属，不改变订阅份数、价格或投递。"]}


def link_source(db: Session, source_id: int, data: SourceLinkIn, operator_id: int | None) -> OrderSource:
    source = get_source(db, source_id, data.version, lock=True)
    validate_links(db, source, data, lock=True)
    bump_version(db, source, data.version)
    old_links = db.query(OrderSourceLink).filter_by(source_id=source_id, active=1).all()
    for link in old_links:
        link.active = 0
    for allocation in data.allocations:
        db.add(OrderSourceLink(source_id=source.id, order_id=allocation.order_id,
            order_item_id=allocation.order_item_id, target_id=allocation.target_id, amount=allocation.amount,
            active=1, reason=data.reason.strip(), created_by=operator_id))
    source_event(db, source, "linked" if data.allocations else "unlinked",
        {"previous_link_ids": [link.id for link in old_links], "reason": data.reason.strip(),
         "allocations": [a.model_dump(mode="json") for a in data.allocations]}, operator_id)
    db.flush()
    return source
