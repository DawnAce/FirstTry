"""邮局跨年续投：补齐订单关联、识别目标月份缺口并生成下一投递段。"""

from calendar import monthrange
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable, Optional

from fastapi import HTTPException
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.models import (
    FulfillmentAllocation,
    FulfillmentTarget,
    Order,
    OrderItem,
    PostalDelivery,
)
from app.models.fulfillment_target import TargetStatus
from app.models.order import OrderStatus
from app.models.order_item import (
    DeliveryMethod,
    FulfillmentType,
    OrderItemStatus,
    Publication,
)
from app.models.postal_delivery import PostalDeliverySourceType


PUBLICATION_LABELS = {
    Publication.cbj: "中国经营报",
    Publication.business_school: "商学院",
    Publication.other: "其他",
}


def month_range(target_month: str) -> tuple[date, date]:
    try:
        start = datetime.strptime(target_month, "%Y-%m").date().replace(day=1)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="目标月份格式应为 YYYY-MM")
    return start, date(start.year, start.month, monthrange(start.year, start.month)[1])


def _months(start: date, end: date) -> int:
    return (end.year - start.year) * 12 + end.month - start.month + 1


def _digits(value: Optional[str]) -> str:
    return "".join(ch for ch in (value or "") if ch.isdigit())


def _same_reader(delivery: PostalDelivery, target: FulfillmentTarget) -> bool:
    delivery_phone = _digits(delivery.recipient_phone)
    target_phone = _digits(target.recipient_phone)
    if delivery_phone and target_phone:
        return delivery_phone == target_phone
    return bool(
        delivery.recipient_name.strip()
        and delivery.recipient_name.strip() == target.recipient_name.strip()
    )


def _latest_targets_for_item(db: Session, item_id: int) -> list[FulfillmentTarget]:
    latest_version = (
        db.query(func.max(FulfillmentAllocation.version_no))
        .filter(FulfillmentAllocation.order_item_id == item_id)
        .scalar()
    )
    if latest_version is None:
        return []
    return (
        db.query(FulfillmentTarget)
        .join(FulfillmentAllocation, FulfillmentAllocation.id == FulfillmentTarget.allocation_id)
        .filter(
            FulfillmentAllocation.order_item_id == item_id,
            FulfillmentAllocation.version_no == latest_version,
            FulfillmentTarget.status == TargetStatus.active,
        )
        .order_by(FulfillmentTarget.id)
        .all()
    )


def _unique_target(
    delivery: PostalDelivery,
    targets: list[FulfillmentTarget],
) -> Optional[FulfillmentTarget]:
    matches = [target for target in targets if _same_reader(delivery, target)]
    if len(matches) == 1:
        return matches[0]
    return targets[0] if len(targets) == 1 else None


def link_exact_deliveries(
    db: Session,
    *,
    delivery_ids: Optional[Iterable[int]] = None,
    commit: bool = True,
) -> dict:
    """仅凭唯一外部订单号及唯一收件目标补正式关联，模糊项保持未关联。"""
    q = db.query(PostalDelivery).filter(
        PostalDelivery.is_archived.is_(False),
        PostalDelivery.order_id.is_(None),
        PostalDelivery.external_order_no.is_not(None),
        PostalDelivery.external_order_no != "",
    )
    ids = list(delivery_ids or [])
    if ids:
        q = q.filter(PostalDelivery.id.in_(ids))
    deliveries = q.order_by(PostalDelivery.id).all()
    external_nos = {delivery.external_order_no for delivery in deliveries}
    orders_by_external: dict[str, list[Order]] = defaultdict(list)
    if external_nos:
        for order in db.query(Order).filter(Order.external_order_no.in_(external_nos)).all():
            orders_by_external[order.external_order_no].append(order)

    linked = 0
    unresolved = 0
    for delivery in deliveries:
        orders = orders_by_external.get(delivery.external_order_no, [])
        if len(orders) != 1:
            unresolved += 1
            continue
        order = orders[0]
        items = [
            item
            for item in order.items
            if item.status == OrderItemStatus.active
            and item.fulfillment_type == FulfillmentType.subscription
            and item.delivery_method == DeliveryMethod.post_office
        ]
        if len(items) != 1:
            unresolved += 1
            continue
        item = items[0]
        target = _unique_target(delivery, _latest_targets_for_item(db, item.id))
        if target is None:
            unresolved += 1
            continue
        delivery.order_id = order.id
        delivery.order_item_id = item.id
        delivery.fulfillment_target_id = target.id
        linked += 1

    if commit:
        db.commit()
    else:
        db.flush()
    return {"linked": linked, "unresolved": unresolved, "examined": len(deliveries)}


def _renewal_candidates(
    db: Session,
    month_start: date,
    month_end: date,
) -> list[tuple[Order, OrderItem, FulfillmentTarget]]:
    latest = (
        db.query(
            FulfillmentAllocation.order_item_id.label("item_id"),
            func.max(FulfillmentAllocation.version_no).label("version_no"),
        )
        .group_by(FulfillmentAllocation.order_item_id)
        .subquery()
    )
    return (
        db.query(Order, OrderItem, FulfillmentTarget)
        .join(OrderItem, OrderItem.order_id == Order.id)
        .join(latest, latest.c.item_id == OrderItem.id)
        .join(
            FulfillmentAllocation,
            and_(
                FulfillmentAllocation.order_item_id == OrderItem.id,
                FulfillmentAllocation.version_no == latest.c.version_no,
            ),
        )
        .join(FulfillmentTarget, FulfillmentTarget.allocation_id == FulfillmentAllocation.id)
        .filter(
            Order.status == OrderStatus.active,
            OrderItem.status == OrderItemStatus.active,
            OrderItem.fulfillment_type == FulfillmentType.subscription,
            OrderItem.delivery_method == DeliveryMethod.post_office,
            OrderItem.coverage_start_date.is_not(None),
            OrderItem.coverage_end_date.is_not(None),
            OrderItem.coverage_start_date <= month_end,
            OrderItem.coverage_end_date >= month_start,
            FulfillmentTarget.status == TargetStatus.active,
        )
        .order_by(Order.id, OrderItem.id, FulfillmentTarget.id)
        .all()
    )


def _proposed_segment(item: OrderItem, month_start: date) -> tuple[date, date]:
    end = item.coverage_end_date
    return month_start, date(
        min(month_start.year, end.year),
        end.month if end.year == month_start.year else 12,
        monthrange(
            min(month_start.year, end.year),
            end.month if end.year == month_start.year else 12,
        )[1],
    )


def _proposed_amount(
    item: OrderItem,
    target: FulfillmentTarget,
    segment_start: date,
    segment_end: date,
) -> Decimal:
    total_months = _months(item.coverage_start_date, item.coverage_end_date)
    segment_months = _months(segment_start, segment_end)
    total_quantity = max(1, item.total_quantity or 1)
    amount = (
        Decimal(str(item.subtotal or 0))
        * Decimal(target.quantity or 1)
        * Decimal(segment_months)
        / Decimal(total_quantity)
        / Decimal(total_months)
    )
    return amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _matches_candidate(
    delivery: PostalDelivery,
    order: Order,
    target: FulfillmentTarget,
) -> bool:
    if delivery.fulfillment_target_id == target.id:
        return True
    return bool(
        delivery.order_id is None
        and order.external_order_no
        and delivery.external_order_no == order.external_order_no
        and _same_reader(delivery, target)
    )


def list_renewals(db: Session, target_month: str) -> dict:
    month_start, month_end = month_range(target_month)
    candidates = _renewal_candidates(db, month_start, month_end)
    order_ids = {order.id for order, _, _ in candidates}
    external_nos = {order.external_order_no for order, _, _ in candidates if order.external_order_no}
    relevant = []
    if candidates:
        relevant = (
            db.query(PostalDelivery)
            .filter(
                PostalDelivery.is_archived.is_(False),
                or_(
                    PostalDelivery.order_id.in_(order_ids),
                    PostalDelivery.external_order_no.in_(external_nos) if external_nos else False,
                ),
            )
            .order_by(PostalDelivery.coverage_end_date.desc(), PostalDelivery.id.desc())
            .all()
        )

    rows = []
    covered = 0
    needs_link = 0
    pending_order_ids = set()
    pending_copies = 0
    for order, item, target in candidates:
        matches = [delivery for delivery in relevant if _matches_candidate(delivery, order, target)]
        overlap = next((
            delivery for delivery in matches
            if delivery.coverage_start_date
            and delivery.coverage_end_date
            and delivery.coverage_start_date <= month_end
            and delivery.coverage_end_date >= month_start
        ), None)
        if overlap is None and order.external_order_no:
            # 同一来源订单存在尚未能唯一分配给收件人的覆盖记录时，宁可阻止生成，
            # 交给“补齐关联”处理，也不能冒险制造重复投递。
            overlap = next((
                delivery for delivery in relevant
                if delivery.order_id is None
                and delivery.external_order_no == order.external_order_no
                and delivery.coverage_start_date
                and delivery.coverage_end_date
                and delivery.coverage_start_date <= month_end
                and delivery.coverage_end_date >= month_start
            ), None)
        if overlap and overlap.fulfillment_target_id == target.id:
            covered += 1
            continue
        status = "needs_link" if overlap else "pending"
        if overlap:
            needs_link += 1
        else:
            pending_order_ids.add(order.id)
            pending_copies += target.quantity or 1
        previous = next((
            delivery for delivery in matches
            if delivery.coverage_end_date and delivery.coverage_end_date < month_start
        ), None)
        segment_start, segment_end = _proposed_segment(item, month_start)
        rows.append({
            "status": status,
            "order_id": order.id,
            "order_code": order.order_code,
            "external_order_no": order.external_order_no,
            "order_item_id": item.id,
            "fulfillment_target_id": target.id,
            "recipient_name": target.recipient_name,
            "recipient_phone": target.recipient_phone,
            "recipient_address": target.recipient_address,
            "product": PUBLICATION_LABELS.get(item.publication, item.publication.value),
            "copies": target.quantity or 1,
            "entitlement_start_date": item.coverage_start_date,
            "entitlement_end_date": item.coverage_end_date,
            "previous_delivery_id": previous.id if previous else None,
            "previous_delivery_no": f"{previous.year}-{previous.delivery_no}" if previous else None,
            "previous_end_date": previous.coverage_end_date if previous else None,
            "proposed_start_date": segment_start,
            "proposed_end_date": segment_end,
            "proposed_amount": _proposed_amount(item, target, segment_start, segment_end),
            "overlap_delivery_id": overlap.id if overlap else None,
            "overlap_delivery_no": f"{overlap.year}-{overlap.delivery_no}" if overlap else None,
        })

    rows.sort(key=lambda row: (row["status"] != "pending", row["recipient_name"], row["order_id"]))
    return {
        "target_month": target_month,
        "rows": rows,
        "total": len(rows),
        "summary": {
            "candidate_count": len(candidates),
            "pending_order_count": len(pending_order_ids),
            "pending_detail_count": sum(row["status"] == "pending" for row in rows),
            "pending_copies": pending_copies,
            "covered_count": covered,
            "needs_link_count": needs_link,
        },
    }


def _next_delivery_number(db: Session, year: int) -> int:
    numbers = db.query(PostalDelivery.delivery_no).filter(PostalDelivery.year == year).all()
    numeric = [int(value) for (value,) in numbers if value and value.isdigit()]
    return max(numeric, default=0) + 1


def generate_renewals(
    db: Session,
    *,
    target_month: str,
    fulfillment_target_ids: list[int],
    operator_id: Optional[int] = None,
) -> dict:
    month_start, month_end = month_range(target_month)
    target_ids = list(dict.fromkeys(fulfillment_target_ids))
    if not target_ids:
        raise HTTPException(status_code=400, detail="请至少选择一条待续投明细")

    # 写操作开始时先把可唯一确认的历史名册补成正式关联，再锁定目标防止重复生成。
    link_result = link_exact_deliveries(db, commit=False)
    (
        db.query(FulfillmentTarget.id)
        .filter(FulfillmentTarget.id.in_(target_ids))
        .with_for_update()
        .all()
    )
    candidate_map = {
        target.id: (order, item, target)
        for order, item, target in _renewal_candidates(db, month_start, month_end)
    }
    renewal_rows = {
        row["fulfillment_target_id"]: row
        for row in list_renewals(db, target_month)["rows"]
    }

    # 同一年度的编号按现有最大值递增；锁住该年度记录，避免两个批次拿到同一编号。
    (
        db.query(PostalDelivery.id)
        .filter(PostalDelivery.year == month_start.year)
        .with_for_update()
        .all()
    )
    next_number = _next_delivery_number(db, month_start.year)
    created = []
    skipped = []
    for target_id in target_ids:
        candidate = candidate_map.get(target_id)
        row = renewal_rows.get(target_id)
        if candidate is None or row is None:
            skipped.append({"fulfillment_target_id": target_id, "reason": "已覆盖或不在目标月份权益内"})
            continue
        if row["status"] != "pending":
            skipped.append({"fulfillment_target_id": target_id, "reason": "存在未补链的同源投递记录，请先补齐关联"})
            continue
        order, item, target = candidate
        duplicate = (
            db.query(PostalDelivery.id)
            .filter(
                PostalDelivery.is_archived.is_(False),
                PostalDelivery.fulfillment_target_id == target.id,
                PostalDelivery.coverage_start_date <= month_end,
                PostalDelivery.coverage_end_date >= month_start,
            )
            .first()
        )
        if duplicate:
            skipped.append({"fulfillment_target_id": target_id, "reason": "目标月份已有投递记录"})
            continue

        previous = db.get(PostalDelivery, row["previous_delivery_id"]) if row["previous_delivery_id"] else None
        source_channel = previous.source_channel if previous else (order.source_store or order.source_platform)
        delivery = PostalDelivery(
            year=month_start.year,
            delivery_no=str(next_number),
            order_id=order.id,
            order_item_id=item.id,
            fulfillment_target_id=target.id,
            external_order_no=order.external_order_no,
            source_type=PostalDeliverySourceType.order_generated,
            recipient_name=previous.recipient_name if previous else target.recipient_name,
            recipient_phone=previous.recipient_phone if previous else target.recipient_phone,
            recipient_province=previous.recipient_province if previous else None,
            recipient_city=previous.recipient_city if previous else None,
            recipient_district=previous.recipient_district if previous else None,
            recipient_address=previous.recipient_address if previous else target.recipient_address,
            recipient_postal_code=previous.recipient_postal_code if previous else target.recipient_postal_code,
            product=previous.product if previous and previous.product else PUBLICATION_LABELS.get(item.publication, item.publication.value),
            copies=target.quantity or 1,
            amount=row["proposed_amount"],
            coverage_start_date=row["proposed_start_date"],
            coverage_end_date=row["proposed_end_date"],
            source_channel=source_channel,
            distribution_unit_id=(previous.distribution_unit_id if previous else target.distribution_unit_id),
            salesperson=previous.salesperson if previous else None,
            remittance_name=previous.remittance_name if previous else order.payer_name,
            notes=f"跨年续投：承接 {target_month}，来源订单 {order.order_code or order.id}",
            created_by=operator_id,
        )
        db.add(delivery)
        db.flush()
        created.append(delivery)
        next_number += 1

    db.commit()
    for delivery in created:
        db.refresh(delivery)
    return {
        "created": created,
        "created_count": len(created),
        "skipped": skipped,
        "skipped_count": len(skipped),
        "linked_existing_count": link_result["linked"],
    }
