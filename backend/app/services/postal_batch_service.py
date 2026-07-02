"""邮局投递 · 每月「起投月」批次生成（归批 + 冻结）。

``generate_batch(year, month)`` 收集当月起投的 post_office 履约目标——即
``delivery_method=post_office`` 且 ``month(coverage_start_date)==(year,month)`` 的在效明细，
把每个收报人目标**冻结**成一条 ``PostalDeliveryRow`` 快照。已发(sent)批次冻结、拒绝重生成；
draft/generated 可重生成（清旧行重建，幂等）。

不触碰中通按刊期的发货明细：post_office 目标本就被 ``order_shipping_sync`` 跳过。
"""

from datetime import date, datetime
from typing import List, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import (
    DeliveryMethod,
    FulfillmentAllocation,
    FulfillmentTarget,
    Order,
    OrderItem,
    OrderItemStatus,
    OrderStatus,
    PostalBatchStatus,
    PostalDeliveryBatch,
    PostalDeliveryRow,
    ShippingChannel,
    TargetStatus,
)
from app.services.address_service import normalize_address


def _candidate_targets(db: Session, year: int, month: int):
    """当月起投的在效 post_office 目标 + 其明细 + 订单。

    「当月起投」用日期区间 [当月1号, 次月1号) 判定——可移植（避免 extract 在
    SQLite/MySQL 上的类型差异）、走 coverage 索引。
    """
    month_start = date(year, month, 1)
    month_end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return (
        db.query(FulfillmentTarget, OrderItem, Order)
        .join(OrderItem, FulfillmentTarget.order_item_id == OrderItem.id)
        .join(Order, OrderItem.order_id == Order.id)
        .join(
            FulfillmentAllocation,
            FulfillmentTarget.allocation_id == FulfillmentAllocation.id,
        )
        .filter(Order.status == OrderStatus.active)
        .filter(OrderItem.status == OrderItemStatus.active)
        .filter(OrderItem.delivery_method == DeliveryMethod.post_office)
        .filter(FulfillmentTarget.status == TargetStatus.active)
        .filter(FulfillmentTarget.shipping_channel == ShippingChannel.post_office)
        .filter(FulfillmentAllocation.effective_until_issue.is_(None))
        .filter(OrderItem.coverage_start_date >= month_start)
        .filter(OrderItem.coverage_start_date < month_end)
        .order_by(FulfillmentTarget.id)
    )


def _freeze_row(batch_id: int, target: FulfillmentTarget, item: OrderItem, order: Order) -> PostalDeliveryRow:
    parsed = {}
    try:
        parsed = normalize_address(target.recipient_address or "")
    except Exception:  # cpca 偶发解析异常不应阻断出批
        parsed = {}
    return PostalDeliveryRow(
        batch_id=batch_id,
        order_item_id=item.id,
        fulfillment_target_id=target.id,
        snap_name=target.recipient_name,
        snap_phone=target.recipient_phone,
        snap_province=parsed.get("province") or None,
        snap_city=parsed.get("city") or None,
        snap_district=parsed.get("district") or None,
        snap_address=target.recipient_address,
        snap_postal_code=target.recipient_postal_code,
        copies=target.quantity,
        coverage_start_date=item.coverage_start_date,
        coverage_end_date=item.coverage_end_date,
        source_channel=order.source_platform,
        distribution_unit_id=target.distribution_unit_id,
        salesperson=None,  # P1：赠阅/关联原样存于 order.notes，结构化归宿留待 P2/P3
        notes=None,
    )


def get_or_create_batch(db: Session, year: int, month: int) -> PostalDeliveryBatch:
    batch = (
        db.query(PostalDeliveryBatch)
        .filter(PostalDeliveryBatch.year == year, PostalDeliveryBatch.month == month)
        .first()
    )
    if batch is None:
        batch = PostalDeliveryBatch(year=year, month=month, status=PostalBatchStatus.draft)
        db.add(batch)
        db.flush()
    return batch


def generate_batch(
    db: Session, year: int, month: int, *, operator_id: Optional[int] = None
) -> PostalDeliveryBatch:
    """按起投月归批并冻结明细。已发批次拒绝重生成。"""
    if not (1 <= month <= 12):
        raise HTTPException(status_code=400, detail="月份需在 1–12")

    batch = get_or_create_batch(db, year, month)
    if batch.status == PostalBatchStatus.sent:
        raise HTTPException(
            status_code=409,
            detail=f"{year}-{month:02d} 批次已发出（冻结），不可重新生成",
        )

    # 重生成：清空旧的冻结行再重建（draft/generated 幂等）。
    db.query(PostalDeliveryRow).filter(
        PostalDeliveryRow.batch_id == batch.id
    ).delete(synchronize_session=False)

    count = 0
    for target, item, order in _candidate_targets(db, year, month):
        db.add(_freeze_row(batch.id, target, item, order))
        count += 1

    batch.row_count = count
    batch.status = PostalBatchStatus.generated
    batch.generated_at = datetime.now()
    db.commit()
    db.refresh(batch)
    return batch


def list_batches(db: Session) -> List[PostalDeliveryBatch]:
    return (
        db.query(PostalDeliveryBatch)
        .order_by(PostalDeliveryBatch.year.desc(), PostalDeliveryBatch.month.desc())
        .all()
    )


def get_batch(db: Session, batch_id: int) -> PostalDeliveryBatch:
    batch = (
        db.query(PostalDeliveryBatch)
        .filter(PostalDeliveryBatch.id == batch_id)
        .first()
    )
    if batch is None:
        raise HTTPException(status_code=404, detail=f"批次 {batch_id} 不存在")
    return batch


def get_batch_rows(db: Session, batch_id: int) -> List[PostalDeliveryRow]:
    get_batch(db, batch_id)  # 404 if missing
    return (
        db.query(PostalDeliveryRow)
        .filter(PostalDeliveryRow.batch_id == batch_id)
        .order_by(PostalDeliveryRow.id)
        .all()
    )


def mark_sent(db: Session, batch_id: int) -> PostalDeliveryBatch:
    batch = get_batch(db, batch_id)
    if batch.status == PostalBatchStatus.draft:
        raise HTTPException(status_code=409, detail="草稿批次尚未生成明细，不能标记已发")
    if batch.status == PostalBatchStatus.sent:
        return batch
    batch.status = PostalBatchStatus.sent
    batch.sent_at = datetime.now()
    db.commit()
    db.refresh(batch)
    return batch
