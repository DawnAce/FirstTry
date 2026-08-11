"""邮局跨年续投：补齐订单关联、识别目标月份缺口并生成下一投递段。"""

from calendar import monthrange
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable, Optional

from fastapi import HTTPException
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, selectinload

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


def diagnose_exact_delivery_link(
    db: Session,
    delivery: PostalDelivery,
) -> tuple[str, str, Optional[Order], Optional[OrderItem], Optional[FulfillmentTarget]]:
    """Explain whether one delivery can be linked without making a fuzzy guess."""
    if delivery.order_id:
        return "linked", "已关联来源订单", None, None, None

    external_order_no = (delivery.external_order_no or "").strip()
    if not external_order_no:
        return "missing_source_no", "未填写来源单号", None, None, None

    orders = db.query(Order).filter(Order.external_order_no == external_order_no).all()
    if not orders:
        return "order_not_found", "来源单号尚未匹配到订单", None, None, None
    if len(orders) != 1:
        return "order_not_unique", "来源单号匹配到多张订单，需人工核对", None, None, None

    order = orders[0]
    items = [
        item
        for item in order.items
        if item.status == OrderItemStatus.active
        and item.fulfillment_type == FulfillmentType.subscription
        and item.delivery_method == DeliveryMethod.post_office
    ]
    if not items:
        return "item_not_found", "订单没有有效的邮局订阅明细", order, None, None
    if len(items) != 1:
        return "item_not_unique", "订单存在多条邮局订阅明细，需人工核对", order, None, None

    item = items[0]
    target = _unique_target(delivery, _latest_targets_for_item(db, item.id))
    if target is None:
        return "target_not_unique", "无法唯一确定订单收件人，需人工核对", order, item, None
    return "ready", "可自动关联来源订单", order, item, target


def diagnose_exact_delivery_links(
    db: Session,
    deliveries: list[PostalDelivery],
) -> dict[int, tuple[str, str]]:
    """Bulk form of :func:`diagnose_exact_delivery_link` for list pages.

    Orders, items and latest targets are loaded in bounded queries instead of
    re-running the full diagnosis for every visible delivery row.
    """
    results: dict[int, tuple[str, str]] = {}
    unresolved = []
    external_nos: set[str] = set()
    for delivery in deliveries:
        if delivery.order_id:
            results[delivery.id] = ("linked", "已关联来源订单")
            continue
        external_no = (delivery.external_order_no or "").strip()
        if not external_no:
            results[delivery.id] = ("missing_source_no", "未填写来源单号")
            continue
        unresolved.append(delivery)
        external_nos.add(external_no)

    if not unresolved:
        return results

    orders = (
        db.query(Order)
        .options(selectinload(Order.items))
        .filter(Order.external_order_no.in_(external_nos))
        .all()
    )
    orders_by_external: dict[str, list[Order]] = {}
    for order in orders:
        orders_by_external.setdefault((order.external_order_no or "").strip(), []).append(order)

    eligible_items: dict[int, list[OrderItem]] = {}
    item_ids: list[int] = []
    for delivery in unresolved:
        matches = orders_by_external.get((delivery.external_order_no or "").strip(), [])
        if not matches:
            results[delivery.id] = ("order_not_found", "来源单号尚未匹配到订单")
            continue
        if len(matches) != 1:
            results[delivery.id] = ("order_not_unique", "来源单号匹配到多张订单，需人工核对")
            continue
        items = [
            item
            for item in matches[0].items
            if item.status == OrderItemStatus.active
            and item.fulfillment_type == FulfillmentType.subscription
            and item.delivery_method == DeliveryMethod.post_office
        ]
        eligible_items[delivery.id] = items
        if len(items) == 1:
            item_ids.append(items[0].id)

    targets_by_item: dict[int, list[FulfillmentTarget]] = {}
    if item_ids:
        latest = (
            db.query(
                FulfillmentAllocation.order_item_id.label("item_id"),
                func.max(FulfillmentAllocation.version_no).label("version_no"),
            )
            .filter(FulfillmentAllocation.order_item_id.in_(item_ids))
            .group_by(FulfillmentAllocation.order_item_id)
            .subquery()
        )
        targets = (
            db.query(FulfillmentTarget)
            .join(
                FulfillmentAllocation,
                FulfillmentAllocation.id == FulfillmentTarget.allocation_id,
            )
            .join(
                latest,
                and_(
                    latest.c.item_id == FulfillmentAllocation.order_item_id,
                    latest.c.version_no == FulfillmentAllocation.version_no,
                ),
            )
            .filter(FulfillmentTarget.status == TargetStatus.active)
            .order_by(FulfillmentTarget.id)
            .all()
        )
        for target in targets:
            targets_by_item.setdefault(target.order_item_id, []).append(target)

    for delivery in unresolved:
        if delivery.id in results:
            continue
        items = eligible_items.get(delivery.id, [])
        if not items:
            results[delivery.id] = ("item_not_found", "订单没有有效的邮局订阅明细")
            continue
        if len(items) != 1:
            results[delivery.id] = ("item_not_unique", "订单存在多条邮局订阅明细，需人工核对")
            continue
        target = _unique_target(delivery, targets_by_item.get(items[0].id, []))
        results[delivery.id] = (
            ("ready", "可自动关联来源订单")
            if target is not None
            else ("target_not_unique", "无法唯一确定订单收件人，需人工核对")
        )
    return results


def try_link_delivery_exact(db: Session, delivery: PostalDelivery) -> tuple[str, str]:
    """Link one delivery when the strict diagnosis resolves one exact target."""
    status, message, order, item, target = diagnose_exact_delivery_link(db, delivery)
    if status != "ready":
        return status, message
    delivery.order_id = order.id
    delivery.order_item_id = item.id
    delivery.fulfillment_target_id = target.id
    sync_applied_delivery_recipient_to_target(db, delivery, target)
    sync_delivery_ticket_order(db, delivery)
    return "linked", "已自动关联来源订单"


def sync_delivery_ticket_order(db: Session, delivery: PostalDelivery) -> int:
    """Keep denormalised ticket ownership aligned with its delivery.

    Tickets are frequently imported before their source order exists.  When a
    delivery is later linked, reassigned or detached, all existing tickets for
    that delivery must follow it or order pages silently lose their history.
    """
    from app.models import PostalTicket

    tickets = (
        db.query(PostalTicket)
        .filter(PostalTicket.postal_delivery_id == delivery.id)
        .all()
    )
    for ticket in tickets:
        ticket.order_id = delivery.order_id
    return len(tickets)


def sync_applied_delivery_recipient_to_target(
    db: Session,
    delivery: PostalDelivery,
    target: FulfillmentTarget,
) -> bool:
    """Carry a pre-order applied address change into the linked order target.

    Historic postal changes can be applied before the commerce order is
    created.  In that sequence the delivery already contains the effective
    recipient while the newly created target still contains the checkout
    snapshot.  Only an explicitly applied address ticket authorises replacing
    the target snapshot during back-linking.
    """
    from app.models import PostalTicket, PostalTicketType

    has_applied_change = db.query(PostalTicket.id).filter(
        PostalTicket.postal_delivery_id == delivery.id,
        PostalTicket.type == PostalTicketType.address,
        PostalTicket.applied_to_order.is_(True),
    ).first()
    if not has_applied_change:
        return False

    target.recipient_name = delivery.recipient_name
    target.recipient_phone = delivery.recipient_phone or target.recipient_phone
    target.recipient_address = delivery.recipient_address
    target.recipient_postal_code = delivery.recipient_postal_code or target.recipient_postal_code
    return True


def link_exact_deliveries(
    db: Session,
    *,
    delivery_ids: Optional[Iterable[int]] = None,
    external_order_nos: Optional[Iterable[str]] = None,
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
    external_filter = [value for value in (external_order_nos or []) if value]
    if external_filter:
        q = q.filter(PostalDelivery.external_order_no.in_(external_filter))
    deliveries = q.order_by(PostalDelivery.id).all()

    linked = 0
    unresolved = 0
    for delivery in deliveries:
        status, _ = try_link_delivery_exact(db, delivery)
        if status != "linked":
            unresolved += 1
            continue
        linked += 1

    if commit:
        db.commit()
    else:
        db.flush()
    return {"linked": linked, "unresolved": unresolved, "examined": len(deliveries)}


def link_deliveries_for_order(db: Session, order: Order) -> dict:
    """Back-link existing deliveries after an order becomes matchable."""
    if not order.external_order_no:
        return {"linked": 0, "unresolved": 0, "examined": 0}
    db.flush()
    return link_exact_deliveries(
        db,
        external_order_nos=[order.external_order_no],
        commit=False,
    )


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
