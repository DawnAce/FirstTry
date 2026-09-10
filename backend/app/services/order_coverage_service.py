"""只补空缺订期。预览与确认共享校验，价格、履约版本和发货行不参与写入。"""
from copy import deepcopy
from datetime import date
import hashlib
import json
from time import monotonic
from typing import Any
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, Query, contains_eager, selectinload
from sqlalchemy.orm.attributes import set_committed_value

from app.models import Order, OrderItem
from app.models.fulfillment_allocation import FulfillmentAllocation
from app.models.fulfillment_target import FulfillmentTarget
from app.models.order import OrderStatus
from app.models.order_event import OrderEventType
from app.models.order_item import FulfillmentType, OrderItemStatus
from app.order_import_cache import get_order_import_session, order_import_lock
from app.schemas.order_coverage import (
    CoverageApplyOut, CoverageCandidate, CoverageCandidatesOut, CoverageChange,
    CoveragePreviewIn, CoveragePreviewOut, CoveragePreviewRow,
)
from app.services.order_event_logger import log_event

_TYPES = (FulfillmentType.subscription, FulfillmentType.extension)
_TTL = 30 * 60
_previews: dict[str, dict] = {}
# 与订单导入缓存相同的单 worker 部署约束。锁同时保护会话草稿及重复确认。
_lock = order_import_lock


def _value(value: Any) -> Any:
    return value.value if hasattr(value, "value") else value


def _hash(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def _blocked(status: str | None, start: object, end: object) -> str | None:
    if status in ("refunded", "partial_refund", "cancelled", "pending_payment"):
        return "退款、取消或待付款订单，请在订单详情单独核对"
    if start and end:
        return "已有完整订期，请在订单详情核对修改"
    return None


def _db_candidate(item: OrderItem) -> CoverageCandidate:
    order = item.order
    latest = max(item.allocations, key=lambda a: a.version_no, default=None)
    names = sorted({t.recipient_name for t in latest.targets if _value(t.status) == "active"}) if latest else []
    state = {
        "order": [order.status, order.commercial_status, order.updated_at, order.paid_amount, order.refunded_amount],
        "item": [item.status, item.updated_at, item.coverage_start_date, item.coverage_end_date,
                 item.subscription_term, item.term_start_month, item.delivery_method, item.publication,
                 item.fulfillment_type, item.total_quantity, item.unit_price, item.subtotal],
        "allocations": [(a.id, a.version_no, a.effective_from_issue, a.effective_until_issue,
                         [(t.id, t.status, t.quantity, t.recipient_name, t.recipient_address,
                           t.recipient_phone, t.recipient_postal_code, t.shipping_channel,
                           t.distribution_unit_id, t.effective_from_issue, t.effective_until_issue,
                           t.replaced_by_target_id, t.updated_at)
                          for t in sorted(a.targets, key=lambda target: target.id)])
                        for a in sorted(item.allocations, key=lambda allocation: allocation.id)],
    }
    blocked = _blocked(_value(order.commercial_status), item.coverage_start_date, item.coverage_end_date)
    if order.status != OrderStatus.active or item.status != OrderItemStatus.active or item.fulfillment_type not in _TYPES:
        blocked = "仅可补录生效订单中有效的订阅或续订明细"
    return CoverageCandidate(
        key=str(item.id), order_id=order.id, external_order_no=order.external_order_no,
        order_date=order.order_date, source_platform=order.source_platform,
        recipient_name="、".join(names) or order.payer_name,
        publication=_value(item.publication), subscription_term=_value(item.subscription_term),
        delivery_method=_value(item.delivery_method), coverage_start_date=item.coverage_start_date,
        coverage_end_date=item.coverage_end_date, version=_hash(state), blocked_reason=blocked,
    )


def _import_payload(session_id: str, owner_id: int) -> dict:
    payload = get_order_import_session(session_id)
    if payload is None:
        raise HTTPException(400, "导入会话已过期，请重新预览 Excel")
    if payload.get("owner_id") != owner_id:
        raise HTTPException(403, "无权修改此导入会话，请重新上传预览")
    return payload


def _import_candidates(payload: dict) -> dict[str, tuple[CoverageCandidate, dict]]:
    result = {}
    for row in payload["rows"]:
        order = row["order_create"]
        for index, item in enumerate(order["items"]):
            if item["fulfillment_type"] not in ("subscription", "extension"):
                continue
            key = f'{order["external_order_no"]}#{index}'
            start, end = item.get("coverage_start_date"), item.get("coverage_end_date")
            candidate = CoverageCandidate(
                key=key, external_order_no=order["external_order_no"], order_date=order["order_date"],
                source_platform=order.get("source_platform"),
                recipient_name="、".join(t["recipient_name"] for t in item.get("targets", [])) or order["payer_name"],
                publication=item["publication"], subscription_term=item.get("subscription_term"),
                delivery_method=item.get("delivery_method"), coverage_start_date=start, coverage_end_date=end,
                version=_hash(row), blocked_reason=_blocked(row.get("commercial_status"), start, end),
            )
            result[key] = (candidate, item)
    return result


def _loaded_query(db: Session) -> Query:
    return db.query(OrderItem).options(
        selectinload(OrderItem.order),
        selectinload(OrderItem.allocations).selectinload(FulfillmentAllocation.targets),
    )


def list_candidates(
    db: Session, owner_id: int, *, import_session_id: str | None = None,
    order_ids: list[int] | None = None, source_platform: str | None = None,
    publication: str | None = None, delivery_method: str | None = None,
    order_date_start: date | None = None, order_date_end: date | None = None,
    missing_only: bool = True, skip: int = 0, limit: int = 50,
) -> CoverageCandidatesOut:
    if import_session_id:
        with _lock:
            rows = [c for c, _ in _import_candidates(_import_payload(import_session_id, owner_id)).values()]
        rows = [r for r in rows if
                (not source_platform or r.source_platform == source_platform)
                and (not publication or r.publication == publication)
                and (not delivery_method or r.delivery_method == delivery_method)
                and (not order_date_start or r.order_date >= order_date_start)
                and (not order_date_end or r.order_date <= order_date_end)
                and (not missing_only or not r.coverage_start_date or not r.coverage_end_date)]
        return CoverageCandidatesOut(rows=rows[skip:skip + limit], total=len(rows),
                                     order_count=len({r.external_order_no for r in rows}))
    query = db.query(OrderItem).join(Order).filter(
        Order.status == OrderStatus.active, OrderItem.status == OrderItemStatus.active,
        OrderItem.fulfillment_type.in_(_TYPES),
    )
    if order_ids is not None:
        query = query.filter(Order.id.in_(order_ids))
    if source_platform:
        query = query.filter(Order.source_platform == source_platform)
    if publication:
        query = query.filter(OrderItem.publication == publication)
    if delivery_method:
        query = query.filter(OrderItem.delivery_method == delivery_method)
    if order_date_start:
        query = query.filter(Order.order_date >= order_date_start)
    if order_date_end:
        query = query.filter(Order.order_date <= order_date_end)
    if missing_only:
        query = query.filter(or_(OrderItem.coverage_start_date.is_(None), OrderItem.coverage_end_date.is_(None)))
    total, order_count = query.with_entities(func.count(OrderItem.id), func.count(func.distinct(Order.id))).one()
    ids = query.with_entities(OrderItem.id).order_by(Order.id.desc(), OrderItem.id).offset(skip).limit(limit).all()
    items = _loaded_query(db).filter(OrderItem.id.in_([i for i, in ids])).order_by(OrderItem.order_id.desc(), OrderItem.id).all()
    return CoverageCandidatesOut(rows=[_db_candidate(i) for i in items], total=total, order_count=order_count)


def _load_changes(db: Session, request: CoveragePreviewIn, owner_id: int, *, lock: bool = False) -> dict:
    if request.import_session_id:
        return _import_candidates(_import_payload(request.import_session_id, owner_id))
    if any(not c.key.isdecimal() for c in request.changes):
        raise HTTPException(422, "订单明细标识无效")
    ids = [int(c.key) for c in request.changes]
    if lock:
        # 所有调用按固定顺序锁订单，再锁明细，避免双刊/多订单相互等待。
        order_ids = db.query(OrderItem.order_id).filter(OrderItem.id.in_(ids)).distinct().all()
        db.query(Order).filter(Order.id.in_([o for o, in order_ids])).order_by(Order.id).with_for_update().populate_existing().all()
        # 联接订单的锁定读保证 MySQL REPEATABLE READ 下校验使用当前状态，
        # 不被事务开始时的普通查询快照覆盖。
        items = (db.query(OrderItem).join(Order).options(
            contains_eager(OrderItem.order),
        ).filter(OrderItem.id.in_(ids)).order_by(OrderItem.id).with_for_update().populate_existing().all())
        # 版本与目标也必须使用当前读，不能沿用等待订单锁之前建立的快照。
        allocations = (db.query(FulfillmentAllocation).filter(FulfillmentAllocation.order_item_id.in_(ids))
                       .order_by(FulfillmentAllocation.id).with_for_update().populate_existing().all())
        targets = (db.query(FulfillmentTarget).filter(FulfillmentTarget.order_item_id.in_(ids))
                   .order_by(FulfillmentTarget.id).with_for_update().populate_existing().all())
        targets_by_allocation: dict[int, list[FulfillmentTarget]] = {}
        for target in targets:
            targets_by_allocation.setdefault(target.allocation_id, []).append(target)
        allocations_by_item: dict[int, list[FulfillmentAllocation]] = {}
        for allocation in allocations:
            set_committed_value(allocation, "targets", targets_by_allocation.get(allocation.id, []))
            allocations_by_item.setdefault(allocation.order_item_id, []).append(allocation)
        for item in items:
            set_committed_value(item, "allocations", allocations_by_item.get(item.id, []))
    else:
        items = _loaded_query(db).filter(OrderItem.id.in_(ids)).populate_existing().all()
    return {str(i.id): (_db_candidate(i), i) for i in items}


def _error(candidate: CoverageCandidate | None, change: CoverageChange) -> str | None:
    if candidate is None:
        return "明细不存在或已不适用于订期补录"
    if candidate.version != change.expected_version:
        return "订单或明细已变更，请刷新后重新预览"
    if candidate.blocked_reason:
        return candidate.blocked_reason
    if candidate.coverage_start_date and candidate.coverage_start_date != change.coverage_start_date:
        return "已有开始日期，请保留原日期，只补结束日期"
    if candidate.coverage_end_date and candidate.coverage_end_date != change.coverage_end_date:
        return "已有结束日期，请保留原日期，只补开始日期"
    return None


def preview_coverage(db: Session, request: CoveragePreviewIn, owner_id: int) -> CoveragePreviewOut:
    with _lock:
        sources = _load_changes(db, request, owner_id)
        rows = []
        orders = set()
        for change in request.changes:
            candidate = sources.get(change.key, (None, None))[0]
            if candidate:
                orders.add(candidate.order_id or candidate.external_order_no)
            rows.append(CoveragePreviewRow(
                key=change.key, external_order_no=candidate.external_order_no if candidate else None,
                publication=candidate.publication if candidate else None,
                old_start=candidate.coverage_start_date if candidate else None,
                old_end=candidate.coverage_end_date if candidate else None,
                new_start=change.coverage_start_date, new_end=change.coverage_end_date,
                error=_error(candidate, change),
            ))
        can_apply = not any(r.error for r in rows)
        token = uuid4().hex if can_apply else None
        now = monotonic()
        for expired in [k for k, v in _previews.items() if now - v["time"] >= _TTL]:
            del _previews[expired]
        if token:
            _previews[token] = {"request": request.model_copy(deep=True), "owner": owner_id, "time": now}
        return CoveragePreviewOut(preview_id=token, can_apply=can_apply, rows=rows, order_count=len(orders))


def apply_coverage(db: Session, token: str, owner_id: int) -> CoverageApplyOut:
    with _lock:
        plan = _previews.get(token)
        if plan is None or monotonic() - plan["time"] >= _TTL:
            raise HTTPException(400, "补订期预览已过期，请重新预览")
        if plan["owner"] != owner_id:
            raise HTTPException(403, "无权确认其他人的订期预览")
        if "result" in plan:
            return plan["result"]
        request = plan["request"]
        try:
            sources = _load_changes(db, request, owner_id, lock=True)
            for change in request.changes:
                error = _error(sources.get(change.key, (None, None))[0], change)
                if error:
                    raise HTTPException(409, f"本批未保存：{error}")
            # 所有行通过才写，失败整批回滚；导入会话则对副本更新后整体替换。
            if request.import_session_id:
                payload = _import_payload(request.import_session_id, owner_id)
                draft = deepcopy(payload)
                sources = _import_candidates(draft)
                import_rows = {r["order_create"]["external_order_no"]: r for r in draft["rows"]}
            orders = set()
            for change in request.changes:
                candidate, item = sources[change.key]
                orders.add(candidate.order_id or candidate.external_order_no)
                values = {"coverage_start_date": change.coverage_start_date,
                          "coverage_end_date": change.coverage_end_date,
                          "term_start_month": change.coverage_start_date.strftime("%Y-%m")}
                if request.import_session_id:
                    field_diff = {k: {"from": item.get(k), "to": str(v)} for k, v in values.items()
                                  if item.get(k) != str(v)}
                    item.update({k: v.isoformat() if isinstance(v, date) else v for k, v in values.items()})
                    import_rows[candidate.external_order_no].setdefault("coverage_fills", []).append({
                        "item_index": int(change.key.rsplit("#", 1)[1]), "field_diff": field_diff,
                        "change_reason": request.reason, "batch_id": token,
                    })
                else:
                    diff = {k: {"from": str(getattr(item, k)) if getattr(item, k) is not None else None,
                                "to": str(v)} for k, v in values.items() if getattr(item, k) != v}
                    for key, value in values.items():
                        setattr(item, key, value)
                    log_event(db, order_id=item.order_id, event_type=OrderEventType.item_modified,
                              operator_id=owner_id, payload={"item_id": item.id, "field_diff": diff, "targets_changed": False,
                              "change_reason": request.reason, "operation": "coverage_fill", "batch_id": token})
            if request.import_session_id:
                payload["rows"] = draft["rows"]
            else:
                db.commit()
            result = CoverageApplyOut(updated=len(request.changes), order_count=len(orders), changes=request.changes)
            plan["result"] = result
            return result
        except Exception:
            db.rollback()
            raise
