"""邮局订报生成 → 投递名册(PostalDelivery) 汇入（方向 B）。

版本「设为有效」时，把该版有效明细写进 PostalDelivery，成为该月起投名单的真源；
月度起投明细(postal_batch_service)照旧按 coverage_start_date 起投月读取即可反映。

* 投递单位：省→集订分送映射，**北京兜底**（查不到本省专属单位即归「北京集订分送」）。
* 编号：订报无天然编号 → 年内流水自增（max 现有数字编号 +1）。
* 幂等：按 subscription_batch_id 先删旧汇入再重建；被**已发**月度批次引用的记录跳过（遵守冻结）。
"""

import re
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Optional

from sqlalchemy.orm import Session

from app.models import (
    Partner,
    PartnerType,
    PostalBatchStatus,
    PostalDelivery,
    PostalDeliveryBatch,
    PostalDeliveryRow,
    PostalDeliverySourceType,
    SubscriptionImportVersion,
)
from app.services.subscription_parser import province_to_region

FALLBACK_UNIT_NAME = "北京集订分送"   # 全国兜底：无本省专属集订分送时归此


def _distribution_map(db: Session) -> dict:
    rows = (
        db.query(Partner.name, Partner.id)
        .filter(Partner.partner_type == PartnerType.distribution)
        .all()
    )
    return {name: pid for name, pid in rows}


def resolve_distribution_unit(db: Session, province: Optional[str], _cache: Optional[dict] = None) -> Optional[int]:
    """省份 → 集订分送单位 id：本省有专属单位则用之，否则归「北京集订分送」（全国兜底）。"""
    dist_map = _cache if _cache is not None else _distribution_map(db)
    region = province_to_region(province)
    if region and f"{region}集订分送" in dist_map:
        return dist_map[f"{region}集订分送"]
    return dist_map.get(FALLBACK_UNIT_NAME)


def _next_delivery_no(db: Session, year: int) -> int:
    """该年度现有数字编号的最大值 +1（作为汇入起始流水）。"""
    nos = db.query(PostalDelivery.delivery_no).filter(PostalDelivery.year == year).all()
    mx = 0
    for (no,) in nos:
        s = "".join(ch for ch in (no or "") if ch.isdigit())
        if s:
            mx = max(mx, int(s))
    return mx + 1


def _parse_remittance_date(raw: Optional[str]) -> Optional[date]:
    """从「20260316到账9860.48」这类原文里取前导 8 位日期；取不出返回 None。"""
    if not raw:
        return None
    m = re.match(r"\s*(\d{8})", raw)
    if not m:
        return None
    s = m.group(1)
    try:
        return date(int(s[:4]), int(s[4:6]), int(s[6:8]))
    except ValueError:
        return None


def _sent_locked_delivery_ids(db: Session, batch_id: int) -> set:
    """本订报批次汇入的记录里、已被『已发』月度批次冻结引用的 postal_delivery_id 集合。"""
    rows = (
        db.query(PostalDeliveryRow.postal_delivery_id)
        .join(PostalDeliveryBatch, PostalDeliveryRow.batch_id == PostalDeliveryBatch.id)
        .join(PostalDelivery, PostalDeliveryRow.postal_delivery_id == PostalDelivery.id)
        .filter(PostalDelivery.subscription_batch_id == batch_id)
        .filter(PostalDeliveryBatch.status == PostalBatchStatus.sent)
        .all()
    )
    return {pid for (pid,) in rows if pid is not None}


def sync_version_to_postal(db: Session, version: SubscriptionImportVersion, operator_id: Optional[int] = None) -> dict:
    """把某有效版本的明细汇入 PostalDelivery（幂等替换）。不 commit，由调用方掌控事务。"""
    batch = version.batch
    year = batch.year
    month = batch.start_month
    coverage_start = date(year, month, 1)
    coverage_end = date(year, 12, 31)

    # 幂等：删旧汇入，但跳过被已发月度批次冻结引用的。
    locked = _sent_locked_delivery_ids(db, batch.id)
    old = (
        db.query(PostalDelivery)
        .filter(PostalDelivery.subscription_batch_id == batch.id)
        .all()
    )
    replaced = 0
    skipped_sent = 0
    for d in old:
        if d.id in locked:
            skipped_sent += 1
            continue
        db.delete(d)
        replaced += 1
    db.flush()

    dist_cache = _distribution_map(db)
    seq = _next_delivery_no(db, year)
    created = 0
    for rec in version.records:
        if rec.excluded:
            continue
        db.add(PostalDelivery(
            year=year,
            delivery_no=str(seq),
            subscription_batch_id=batch.id,
            source_type=PostalDeliverySourceType.subscription_generated,
            recipient_name=rec.name or "(未填写)",
            recipient_phone=rec.phone or None,
            recipient_province=rec.province or None,
            recipient_city=rec.city or None,
            recipient_district=rec.district or None,
            recipient_address=rec.address or "(未填写)",
            recipient_postal_code=rec.postal_code or None,
            product="中国经营报",
            copies=int(rec.copies or 0),
            amount=rec.amount if rec.amount is not None else None,
            coverage_start_date=coverage_start,
            coverage_end_date=coverage_end,
            source_channel=rec.source_channel or None,
            distribution_unit_id=resolve_distribution_unit(db, rec.province, dist_cache),
            remittance_name=rec.remittance_name or None,
            remittance_date=_parse_remittance_date(rec.remittance_date),
            created_by=operator_id,
        ))
        seq += 1
        created += 1

    return {"created": created, "replaced": replaced, "skipped_sent": skipped_sent}
