"""邮局投递 · 每月「起投月」明细批次生成（归批 + 冻结）。

``generate_batch(year, month)`` 收集当月起投的**投递记录**——即 ``coverage_start_date`` 落在
``[当月1号, 次月1号)`` 的 ``PostalDelivery``，把每条**冻结**成一条 ``PostalDeliveryRow`` 快照
（溯源 postal_delivery_id）。已发(sent)批次冻结、拒绝重生成；draft/generated 可重生成
（清旧行重建，幂等）。

重构后：数据来源是投递记录（不再 JOIN 订单目标）。邮局是投递方式、与中通同级——本就不进
中通按刊期的发货明细。
"""

from datetime import date, datetime
from typing import List, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import (
    PostalBatchStatus,
    PostalDelivery,
    PostalDeliveryBatch,
    PostalDeliveryRow,
)
from app.services.address_service import normalize_address


def _candidate_deliveries(db: Session, year: int, month: int):
    """当月起投的投递记录：``coverage_start_date`` ∈ [当月1号, 次月1号)。

    用日期区间判定「起投月」——可移植（避免 extract 在 SQLite/MySQL 上的类型差异）、走
    coverage_start_date 索引。年度由该区间天然编码，不再单独按 year 列过滤。
    """
    month_start = date(year, month, 1)
    month_end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return (
        db.query(PostalDelivery)
        .filter(PostalDelivery.coverage_start_date.isnot(None))
        .filter(PostalDelivery.coverage_start_date >= month_start)
        .filter(PostalDelivery.coverage_start_date < month_end)
        .order_by(PostalDelivery.id)
    )


def _freeze_row(batch_id: int, d: PostalDelivery) -> PostalDeliveryRow:
    # 省/市/区优先用投递记录已拆好的；都空则 normalize_address 兜底（不阻断出批）。
    province, city, district = d.recipient_province, d.recipient_city, d.recipient_district
    if not (province or city or district):
        try:
            parsed = normalize_address(d.recipient_address or "")
            province = parsed.get("province") or None
            city = parsed.get("city") or None
            district = parsed.get("district") or None
        except Exception:  # cpca 偶发解析异常不应阻断出批
            pass
    return PostalDeliveryRow(
        batch_id=batch_id,
        postal_delivery_id=d.id,
        # 投递记录挂了真实订单时带上溯源（多数为空）。
        order_item_id=d.order_item_id,
        fulfillment_target_id=d.fulfillment_target_id,
        snap_name=d.recipient_name,
        snap_phone=d.recipient_phone,
        snap_province=province,
        snap_city=city,
        snap_district=district,
        snap_address=d.recipient_address,
        snap_postal_code=d.recipient_postal_code,
        copies=d.copies,
        coverage_start_date=d.coverage_start_date,
        coverage_end_date=d.coverage_end_date,
        source_channel=d.source_channel,
        distribution_unit_id=d.distribution_unit_id,
        salesperson=d.salesperson,
        notes=d.notes,
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
    for d in _candidate_deliveries(db, year, month):
        db.add(_freeze_row(batch.id, d))
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
