from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Iterable

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models import Issue, Order, OrderStatus, PublicationSchedule, ShippingDetail
from app.models.fulfillment_allocation import FulfillmentAllocation
from app.models.fulfillment_target import FulfillmentTarget, ShippingChannel, TargetStatus
from app.models.order_event import OrderEventType
from app.models.order_item import (
    FulfillmentType,
    OrderItem,
    OrderItemStatus,
    PublicationFormat,
)
from app.models.shipping_detail import (
    ShippingDetailSourceType,
    ShippingDetailSyncStatus,
)
from app.schemas.order import (
    OrderShippingSyncItem,
    OrderShippingSyncPreview,
    OrderShippingSyncSummary,
)
from app.services.address_service import normalize_address
from app.services.order_event_logger import log_event


SYNC_FIELDS = (
    "sheet_name",
    "channel",
    "company",
    "transport",
    "frequency",
    "status",
    "name",
    "address",
    "phone",
    "quantity",
    "notes",
    "extra_info",
)
COVERAGE_BASED_FULFILLMENT_TYPES = {
    FulfillmentType.subscription,
    FulfillmentType.gift,
    FulfillmentType.extension,
    FulfillmentType.replacement,
}


@dataclass(frozen=True)
class SyncCandidate:
    order: Order
    item: OrderItem
    target: FulfillmentTarget
    data: dict


def preview_order_shipping_sync(
    db: Session,
    order_id: int,
    issue_number: int,
) -> OrderShippingSyncPreview:
    issue = _get_issue(db, issue_number)
    order = _get_order(db, order_id)
    if _is_suspended_issue(db, issue):
        return OrderShippingSyncPreview(
            order_id=order_id,
            issue_number=issue_number,
            summary=OrderShippingSyncSummary(),
            items=[],
            message="目标期号为休刊期，不生成发货明细",
        )

    candidates, skipped = _build_candidates(order, issue_number, issue.publish_date)
    items: list[OrderShippingSyncItem] = skipped[:]
    summary = OrderShippingSyncSummary(skipped=len(skipped))

    for candidate in candidates:
        summary.candidates += 1
        linked = _find_linked_detail(db, issue_number, candidate)
        if linked is None:
            possible_duplicate = _find_possible_manual_duplicate(
                db,
                issue_number,
                candidate,
            )
            if possible_duplicate is not None:
                summary.conflicts += 1
                items.append(
                    _preview_item(
                        "conflict",
                        candidate,
                        possible_duplicate,
                        "存在疑似重复的手工发货明细",
                    )
                )
            else:
                summary.to_create += 1
                items.append(_preview_item("create", candidate, None, None))
            continue

        if linked.sync_status == ShippingDetailSyncStatus.manually_modified:
            summary.conflicts += 1
            items.append(_preview_item("conflict", candidate, linked, "订单生成行已被人工修改"))
            continue

        diff = _diff_detail(linked, candidate.data)
        if diff:
            summary.to_update += 1
            items.append(_preview_item("update", candidate, linked, None, diff))
        else:
            summary.skipped += 1
            items.append(_preview_item("skip", candidate, linked, "已同步，无字段变化"))

    return OrderShippingSyncPreview(
        order_id=order_id,
        issue_number=issue_number,
        summary=summary,
        items=items,
    )


def apply_order_shipping_sync(
    db: Session,
    order_id: int,
    issue_number: int,
    operator_id: int | None,
) -> OrderShippingSyncPreview:
    preview = preview_order_shipping_sync(db, order_id, issue_number)
    if preview.summary.conflicts:
        log_event(
            db,
            order_id=order_id,
            event_type=OrderEventType.shipping_sync_conflict,
            payload={
                "issue_number": issue_number,
                "conflict_count": preview.summary.conflicts,
                "target_ids": [
                    item.fulfillment_target_id
                    for item in preview.items
                    if item.action == "conflict" and item.fulfillment_target_id is not None
                ],
            },
            operator_id=operator_id,
        )
        db.commit()
        raise HTTPException(status_code=409, detail=preview.model_dump())

    issue = _get_issue(db, issue_number)
    if _is_suspended_issue(db, issue):
        return preview
    order = _get_order(db, order_id)
    candidates, _ = _build_candidates(order, issue_number, issue.publish_date)
    created_count = 0
    updated_count = 0

    for candidate in candidates:
        linked = _find_linked_detail(db, issue_number, candidate)
        if linked is None:
            db.add(ShippingDetail(**candidate.data))
            created_count += 1
            continue

        diff = _diff_detail(linked, candidate.data)
        if diff:
            for field in SYNC_FIELDS:
                setattr(linked, field, candidate.data[field])
            linked.source_type = ShippingDetailSourceType.order_generated
            linked.sync_status = ShippingDetailSyncStatus.synced
            updated_count += 1

    if created_count or updated_count:
        log_event(
            db,
            order_id=order_id,
            event_type=OrderEventType.synced_to_shipping,
            payload={
                "issue_number": issue_number,
                "created_count": created_count,
                "updated_count": updated_count,
            },
            operator_id=operator_id,
        )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if _is_order_target_issue_unique_violation(exc):
            return preview_order_shipping_sync(db, order_id, issue_number)
        raise
    return preview_order_shipping_sync(db, order_id, issue_number)


def _get_issue(db: Session, issue_number: int) -> Issue:
    issue = db.query(Issue).filter(Issue.issue_number == issue_number).first()
    if issue is None:
        raise HTTPException(status_code=404, detail=f"刊期 {issue_number} 不存在")
    return issue


def _get_order(db: Session, order_id: int) -> Order:
    order = (
        db.query(Order)
        .options(
            selectinload(Order.items)
            .selectinload(OrderItem.allocations)
            .selectinload(FulfillmentAllocation.targets),
            selectinload(Order.items).selectinload(OrderItem.targets),
        )
        .filter(Order.id == order_id)
        .first()
    )
    if order is None:
        raise HTTPException(status_code=404, detail=f"订单 {order_id} 不存在")
    if order.status != OrderStatus.active:
        raise HTTPException(
            status_code=409,
            detail="仅可将已激活的订单同步至发货明细",
        )
    return order


def _is_suspended_issue(db: Session, issue: Issue) -> bool:
    if getattr(issue, "is_suspended", False):
        return True
    return (
        db.query(PublicationSchedule)
        .filter(
            PublicationSchedule.publish_date == issue.publish_date,
            PublicationSchedule.is_suspended.is_(True),
            or_(
                PublicationSchedule.issue_number == issue.issue_number,
                PublicationSchedule.issue_number.is_(None),
            ),
        )
        .first()
        is not None
    )


def _build_candidates(
    order: Order,
    issue_number: int,
    publish_date: date,
) -> tuple[list[SyncCandidate], list[OrderShippingSyncItem]]:
    candidates: list[SyncCandidate] = []
    skipped: list[OrderShippingSyncItem] = []
    for item in order.items:
        if item.status != OrderItemStatus.active:
            skipped.append(_skip_item(order.id, item.id, None, "订单明细已取消"))
            continue
        if item.publication_format != PublicationFormat.paper:
            skipped.append(_skip_item(order.id, item.id, None, "非纸刊明细不生成中通发货"))
            continue
        if _is_coverage_based_item(item) and (
            item.coverage_start_date is None or item.coverage_end_date is None
        ):
            skipped.append(_skip_item(order.id, item.id, None, "覆盖期缺失"))
            continue
        if not _item_applies_to_issue(item, issue_number, publish_date):
            continue
        allocation = _select_allocation(item.allocations, issue_number)
        if allocation is None:
            skipped.append(_skip_item(order.id, item.id, None, "当期没有生效的履约方案"))
            continue
        for target in allocation.targets:
            if target.status != TargetStatus.active:
                skipped.append(_skip_item(order.id, item.id, target.id, "履约目标非 active"))
                continue
            if target.shipping_channel != ShippingChannel.zto_outsource:
                skipped.append(_skip_item(order.id, item.id, target.id, "非中通外包目标"))
                continue
            if not _target_applies_to_issue(target, issue_number):
                continue
            if not target.recipient_name or not target.recipient_address:
                skipped.append(_skip_item(order.id, item.id, target.id, "收件人姓名或地址缺失"))
                continue
            candidates.append(
                SyncCandidate(
                    order=order,
                    item=item,
                    target=target,
                    data=_candidate_data(order, item, target, issue_number),
                )
            )
    return candidates, skipped


def _item_applies_to_issue(
    item: OrderItem,
    issue_number: int,
    publish_date: date,
) -> bool:
    if item.fulfillment_type in {FulfillmentType.single_issue, FulfillmentType.makeup}:
        return item.issue_number == issue_number
    if _is_coverage_based_item(item) and (
        item.coverage_start_date is None or item.coverage_end_date is None
    ):
        return False
    if item.coverage_start_date and publish_date < item.coverage_start_date:
        return False
    if item.coverage_end_date and publish_date > item.coverage_end_date:
        return False
    return True


def _is_coverage_based_item(item: OrderItem) -> bool:
    return item.fulfillment_type in COVERAGE_BASED_FULFILLMENT_TYPES


def _is_order_target_issue_unique_violation(exc: IntegrityError) -> bool:
    text = " ".join(str(part) for part in exc.args)
    return "uq_shipping_detail_order_target_issue" in text


def _target_applies_to_issue(target: FulfillmentTarget, issue_number: int) -> bool:
    if target.effective_from_issue is not None and issue_number < target.effective_from_issue:
        return False
    if target.effective_until_issue is not None and issue_number > target.effective_until_issue:
        return False
    return True


def _select_allocation(
    allocations: Iterable[FulfillmentAllocation],
    issue_number: int,
) -> FulfillmentAllocation | None:
    candidates = [
        alloc
        for alloc in allocations
        if (alloc.effective_from_issue is None or alloc.effective_from_issue <= issue_number)
        and (alloc.effective_until_issue is None or alloc.effective_until_issue >= issue_number)
    ]
    if not candidates:
        return None
    return sorted(candidates, key=lambda alloc: alloc.version_no, reverse=True)[0]


def _candidate_data(
    order: Order,
    item: OrderItem,
    target: FulfillmentTarget,
    issue_number: int,
) -> dict:
    parsed_address = _normalize_address(target.recipient_address)
    notes = f"订单 {order.order_code or order.id}；明细 {item.id}；履约类型 {item.fulfillment_type.value}"
    if target.notes:
        notes = f"{notes}；目标备注：{target.notes}"
    return {
        "issue_number": issue_number,
        "sheet_name": "ZTO-MF",
        "channel": order.source_platform or "个人订阅",
        "company": order.source_store,
        "transport": "中通物流",
        "frequency": "周",
        "status": "正常",
        "name": target.recipient_name,
        "address": parsed_address,
        "phone": target.recipient_phone,
        "quantity": target.quantity,
        "notes": notes,
        "extra_info": f"order_item_id={item.id}; fulfillment_target_id={target.id}",
        "order_id": order.id,
        "order_item_id": item.id,
        "fulfillment_target_id": target.id,
        "source_type": ShippingDetailSourceType.order_generated,
        "sync_status": ShippingDetailSyncStatus.synced,
    }


def _normalize_address(address: str) -> str:
    try:
        parsed = normalize_address(address)
    except Exception:
        return address
    if isinstance(parsed, dict) and parsed.get("address"):
        return parsed["address"]
    return address


def _find_linked_detail(
    db: Session,
    issue_number: int,
    candidate: SyncCandidate,
) -> ShippingDetail | None:
    return (
        db.query(ShippingDetail)
        .filter(
            ShippingDetail.issue_number == issue_number,
            ShippingDetail.order_id == candidate.order.id,
            ShippingDetail.order_item_id == candidate.item.id,
            ShippingDetail.fulfillment_target_id == candidate.target.id,
        )
        .first()
    )


def _find_possible_manual_duplicate(
    db: Session,
    issue_number: int,
    candidate: SyncCandidate,
) -> ShippingDetail | None:
    return (
        db.query(ShippingDetail)
        .filter(
            ShippingDetail.issue_number == issue_number,
            ShippingDetail.order_id.is_(None),
            ShippingDetail.name == candidate.target.recipient_name,
            ShippingDetail.phone == candidate.target.recipient_phone,
        )
        .first()
    )


def _diff_detail(detail: ShippingDetail, data: dict) -> dict:
    diff = {}
    for field in SYNC_FIELDS:
        old = getattr(detail, field)
        new = data[field]
        if old != new:
            diff[field] = {"old": old, "new": new}
    return diff


def _preview_item(
    action: str,
    candidate: SyncCandidate,
    detail: ShippingDetail | None,
    reason: str | None,
    diff: dict | None = None,
) -> OrderShippingSyncItem:
    return OrderShippingSyncItem(
        action=action,
        order_id=candidate.order.id,
        order_item_id=candidate.item.id,
        fulfillment_target_id=candidate.target.id,
        shipping_detail_id=detail.id if detail else None,
        name=candidate.target.recipient_name,
        quantity=candidate.target.quantity,
        reason=reason,
        diff=diff,
    )


def _skip_item(
    order_id: int,
    item_id: int | None,
    target_id: int | None,
    reason: str,
) -> OrderShippingSyncItem:
    return OrderShippingSyncItem(
        action="skip",
        order_id=order_id,
        order_item_id=item_id,
        fulfillment_target_id=target_id,
        reason=reason,
    )
