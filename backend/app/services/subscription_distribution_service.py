"""有效订报批次的投递单位核对；保留激活时的自动分配规则。"""

import hashlib
import json
from collections.abc import Iterable

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Query, Session

from app.models import OperationLog, Partner, PartnerType, PostalDelivery, User
from app.schemas.subscription import BatchDeliveryUnitsUpdateIn
from app.services.operation_log_service import record_operation
from app.services.subscription_service import get_batch

ACTION = "update_distribution_units"
CONFLICT = "批次版本或投递记录已变化，请重新打开投递单位窗口核对后保存"


def _query(db: Session, batch_id: int) -> Query[PostalDelivery]:
    return db.query(PostalDelivery).filter(
        PostalDelivery.subscription_batch_id == batch_id,
        PostalDelivery.is_archived.is_(False),
    )


def _snapshot(version_id: int, rows: Iterable[Iterable[object]]) -> str:
    digest = hashlib.sha256(str(version_id).encode())
    for row in rows:
        digest.update(json.dumps(list(row), default=str, separators=(",", ":")).encode())
        digest.update(b"\n")
    return digest.hexdigest()


def _snapshot_query(db: Session, batch_id: int) -> Query:
    # 除投递单位和更新时间外，把核对窗口中用于判断的字段一并纳入快照。
    # MySQL 的普通 DateTime 只有秒级精度；若只依赖 updated_at，同一秒内
    # 修改地区或份数可能漏掉冲突。列表明细仍由数据库分页。
    return _query(db, batch_id).with_entities(
        PostalDelivery.id,
        PostalDelivery.year,
        PostalDelivery.delivery_no,
        PostalDelivery.recipient_name,
        PostalDelivery.recipient_province,
        PostalDelivery.recipient_city,
        PostalDelivery.recipient_district,
        PostalDelivery.copies,
        PostalDelivery.distribution_unit_id,
        PostalDelivery.updated_at,
    ).order_by(PostalDelivery.id)


def list_distribution_units(db: Session, batch_id: int, *, page: int, page_size: int) -> dict:
    batch = get_batch(db, batch_id)
    if batch.active_version_id is None:
        raise HTTPException(status_code=409, detail="请先将批次版本设为有效")
    q = _query(db, batch_id).outerjoin(Partner, Partner.id == PostalDelivery.distribution_unit_id)
    counts = q.with_entities(
        PostalDelivery.distribution_unit_id, Partner.name, func.count(PostalDelivery.id),
    ).group_by(PostalDelivery.distribution_unit_id, Partner.name).all()
    columns = ["id", "year", "delivery_no", "recipient_name", "recipient_province",
               "recipient_city", "recipient_district", "copies", "distribution_unit_id"]
    rows = q.with_entities(
        *(getattr(PostalDelivery, column) for column in columns),
        Partner.name.label("distribution_unit_name"),
    ).order_by(PostalDelivery.id).offset((page - 1) * page_size).limit(page_size).all()
    units = db.query(Partner.id, Partner.name).filter(
        Partner.partner_type == PartnerType.distribution, Partner.active.is_(True),
    ).order_by(Partner.name).all()
    return {
        "active_version_id": batch.active_version_id,
        "snapshot": _snapshot(batch.active_version_id, _snapshot_query(db, batch_id).yield_per(500)),
        "total": sum(count for _, _, count in counts),
        "rows": [dict(row._mapping) for row in rows],
        "units": [{"id": unit.id, "name": unit.name} for unit in units],
        "unit_counts": [{"id": unit_id, "name": name or "待补投递单位", "count": count}
                        for unit_id, name, count in counts],
    }


def update_distribution_units(
    db: Session, batch_id: int, body: BatchDeliveryUnitsUpdateIn, *, user: User,
) -> dict:
    """锁定、复核、修改及审计在同一事务完成；同一请求重试返回首次结果。"""
    payload_hash = hashlib.sha256(body.model_dump_json().encode()).hexdigest()
    try:
        batch = get_batch(db, batch_id, for_update=True)
        previous = db.query(OperationLog).filter(
            OperationLog.table_name == "subscription_batches",
            OperationLog.record_id == batch_id,
            OperationLog.action == ACTION,
            OperationLog.user_id == user.id,
            OperationLog.changes["request_id"].as_string() == str(body.request_id),
        ).with_for_update().first()
        if previous:
            if previous.changes["payload_hash"] != payload_hash:
                raise HTTPException(status_code=409, detail="重复请求内容不一致，请重新核对")
            result = previous.changes["result"]
            db.rollback()
            return result
        if batch.active_version_id != body.active_version_id:
            raise HTTPException(status_code=409, detail=CONFLICT)

        rows = _snapshot_query(db, batch_id).with_for_update().all()
        if _snapshot(batch.active_version_id, rows) != body.snapshot:
            raise HTTPException(status_code=409, detail=CONFLICT)
        overrides = {row.delivery_id: row.distribution_unit_id for row in body.updates}
        if not overrides.keys() <= {row.id for row in rows}:
            raise HTTPException(status_code=409, detail="所选记录已移除、归档或不属于当前批次，请重新核对")
        unit_ids = set(overrides.values())
        if body.all_distribution_unit_id is not None:
            unit_ids.add(body.all_distribution_unit_id)
        valid_units = db.query(Partner.id).filter(
            Partner.id.in_(unit_ids), Partner.partner_type == PartnerType.distribution,
            Partner.active.is_(True),
        ).with_for_update().all()
        if unit_ids != {unit.id for unit in valid_units}:
            raise HTTPException(status_code=422, detail="请选择仍在启用的集订分送单位")

        updates, audit_rows = [], []
        for row in rows:
            target = overrides.get(row.id, body.all_distribution_unit_id)
            if target is None or target == row.distribution_unit_id:
                continue
            updates.append({"id": row.id, "distribution_unit_id": target})
            audit_rows.append({"id": row.id, "distribution_unit_id": {"old": row.distribution_unit_id, "new": target}})
        if updates:
            db.bulk_update_mappings(PostalDelivery, updates)
        result = {"changed": len(updates)}
        record_operation(
            db, table_name="subscription_batches", record_id=batch_id, action=ACTION, user=user,
            record_name=f"{batch.year}年{batch.start_month}月投递单位调整 · {len(updates)}条",
            changes={"request_id": str(body.request_id), "payload_hash": payload_hash,
                     "active_version_id": batch.active_version_id, "result": result, "deliveries": audit_rows},
        )
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise
