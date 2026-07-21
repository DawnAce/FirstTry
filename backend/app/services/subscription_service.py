"""邮局订报数据生成模块 · 批次 CRUD + 版本激活。"""

from typing import List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import (
    SubscriptionBatch,
    SubscriptionBatchStatus,
    SubscriptionImportStatus,
    SubscriptionImportVersion,
)


def create_batch(db: Session, payload: dict, operator_id: Optional[int] = None) -> SubscriptionBatch:
    exists = (
        db.query(SubscriptionBatch)
        .filter(
            SubscriptionBatch.year == payload["year"],
            SubscriptionBatch.start_month == payload["start_month"],
        )
        .first()
    )
    if exists:
        raise HTTPException(status_code=409, detail=f"{payload['year']}年{payload['start_month']}月 订报批次已存在")
    batch = SubscriptionBatch(
        year=payload["year"],
        start_month=payload["start_month"],
        make_date=payload.get("make_date"),
        unit_price=payload.get("unit_price"),
        notes=payload.get("notes"),
        created_by=operator_id,
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)
    return batch


def list_batches(db: Session) -> List[SubscriptionBatch]:
    return (
        db.query(SubscriptionBatch)
        .order_by(SubscriptionBatch.year.desc(), SubscriptionBatch.start_month.desc())
        .all()
    )


def get_batch(db: Session, batch_id: int) -> SubscriptionBatch:
    batch = db.query(SubscriptionBatch).filter(SubscriptionBatch.id == batch_id).first()
    if batch is None:
        raise HTTPException(status_code=404, detail=f"订报批次 {batch_id} 不存在")
    return batch


def get_version(db: Session, version_id: int) -> SubscriptionImportVersion:
    v = db.query(SubscriptionImportVersion).filter(SubscriptionImportVersion.id == version_id).first()
    if v is None:
        raise HTTPException(status_code=404, detail=f"导入版本 {version_id} 不存在")
    return v


def next_version_no(db: Session, batch_id: int) -> int:
    last = (
        db.query(SubscriptionImportVersion.version_no)
        .filter(SubscriptionImportVersion.batch_id == batch_id)
        .order_by(SubscriptionImportVersion.version_no.desc())
        .first()
    )
    return (last[0] + 1) if last else 1


def activate_version(db: Session, version_id: int, operator_id: Optional[int] = None) -> SubscriptionImportVersion:
    """把校验通过的版本设为当前有效；旧 active 版本置 superseded；同事务汇入投递名册。"""
    version = get_version(db, version_id)
    if version.status not in (SubscriptionImportStatus.validation_passed, SubscriptionImportStatus.active):
        raise HTTPException(status_code=409, detail="仅校验通过的版本可设为当前有效")
    batch = get_batch(db, version.batch_id)

    # 旧 active → superseded。
    for v in batch.versions:
        if v.id != version.id and v.status == SubscriptionImportStatus.active:
            v.status = SubscriptionImportStatus.superseded

    version.status = SubscriptionImportStatus.active
    batch.active_version_id = version.id
    if batch.status in (SubscriptionBatchStatus.draft, SubscriptionBatchStatus.pending_validation):
        batch.status = SubscriptionBatchStatus.ready

    # 汇入投递名册（方向 B：订报生成为唯一真源）。
    from app.services import subscription_postal_sync_service as sync_svc
    sync_result = sync_svc.sync_version_to_postal(db, version, operator_id=operator_id)

    db.commit()
    db.refresh(version)
    setattr(version, "postal_sync", sync_result)
    return version


def issue_counts(version: SubscriptionImportVersion) -> dict:
    counts = {"block": 0, "warn": 0, "info": 0}
    for it in version.issues:
        counts[it.level.value] = counts.get(it.level.value, 0) + 1
    return counts
