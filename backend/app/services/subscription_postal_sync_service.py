"""邮局订报生成 → 投递名册(PostalDelivery) 汇入（方向 B）。

版本「设为有效」时，把该版有效明细写进 PostalDelivery，成为该月起投名单的真源。

* 投递单位：省→集订分送映射，**北京兜底**（查不到本省专属单位即归「北京集订分送」）。
* 编号：订报无天然编号 → 年内流水自增（max 现有数字编号 +1）。
* 幂等：同一订户原位更新，保留 ``PostalDelivery.id / delivery_no``；新版已移除的订户
  只归档不物理删除，避免工单外键被 ``SET NULL``。
"""

import re
from collections import defaultdict, deque
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Optional

from sqlalchemy.orm import Session

from app.models import (
    Partner,
    PartnerType,
    PostalDelivery,
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


def _record_key(name: Optional[str], phone: Optional[str]) -> tuple[str, str]:
    """订报源没有天然主键，沿用导入校验的「姓名 + 电话」作为批次内稳定身份。"""
    normalized_name = " ".join((name or "").strip().casefold().split())
    normalized_phone = "".join(ch for ch in (phone or "") if ch.isdigit())
    return normalized_name, normalized_phone


def _apply_record(
    delivery: PostalDelivery,
    rec,
    *,
    batch_id: int,
    year: int,
    coverage_start: date,
    coverage_end: date,
    distribution_unit_id: Optional[int],
) -> None:
    """把当前版本字段写入既有/新建投递记录；身份字段 id、delivery_no 保持不变。"""
    delivery.year = year
    delivery.subscription_batch_id = batch_id
    delivery.is_archived = False
    delivery.source_type = PostalDeliverySourceType.subscription_generated
    delivery.recipient_name = rec.name or "(未填写)"
    delivery.recipient_phone = rec.phone or None
    delivery.recipient_province = rec.province or None
    delivery.recipient_city = rec.city or None
    delivery.recipient_district = rec.district or None
    delivery.recipient_address = rec.address or "(未填写)"
    delivery.recipient_postal_code = rec.postal_code or None
    delivery.product = "中国经营报"
    delivery.copies = int(rec.copies or 0)
    delivery.amount = rec.amount if rec.amount is not None else None
    delivery.coverage_start_date = coverage_start
    delivery.coverage_end_date = coverage_end
    delivery.source_channel = rec.source_channel or None
    delivery.distribution_unit_id = distribution_unit_id
    delivery.remittance_name = rec.remittance_name or None
    delivery.remittance_date = _parse_remittance_date(rec.remittance_date)


def sync_version_to_postal(db: Session, version: SubscriptionImportVersion, operator_id: Optional[int] = None) -> dict:
    """把有效版本原位同步到 PostalDelivery；不 commit，由调用方掌控事务。"""
    batch = version.batch
    year = batch.year
    month = batch.start_month
    coverage_start = date(year, month, 1)
    coverage_end = date(year, 12, 31)

    # 锁住本批次旧记录，防止两个激活动作同时分配编号或互相覆盖。
    old = (
        db.query(PostalDelivery)
        .filter(PostalDelivery.subscription_batch_id == batch.id)
        .order_by(PostalDelivery.id)
        .with_for_update()
        .all()
    )
    old_by_key = defaultdict(deque)
    for d in old:
        old_by_key[_record_key(d.recipient_name, d.recipient_phone)].append(d)
        # 默认归档；当前版本匹配到时由 _apply_record 恢复为有效。
        d.is_archived = True

    dist_cache = _distribution_map(db)
    seq = _next_delivery_no(db, year)
    created = 0
    updated = 0
    for rec in version.records:
        if rec.excluded:
            continue
        candidates = old_by_key.get(_record_key(rec.name, rec.phone))
        delivery = candidates.popleft() if candidates else None
        if delivery is None:
            delivery = PostalDelivery(
                year=year,
                delivery_no=str(seq),
                created_by=operator_id,
            )
            db.add(delivery)
            seq += 1
            created += 1
        else:
            updated += 1
        _apply_record(
            delivery,
            rec,
            batch_id=batch.id,
            year=year,
            coverage_start=coverage_start,
            coverage_end=coverage_end,
            distribution_unit_id=resolve_distribution_unit(db, rec.province, dist_cache),
        )

    # skipped_sent 恒为 0：月度批次冻结层已移除，保留字段仅为响应结构兼容。
    archived = sum(1 for d in old if d.is_archived)
    return {
        "created": created,
        "updated": updated,
        "archived": archived,
        "replaced": len(old),  # 兼容既有调用方：本次处理的上一版记录数。
        "skipped_sent": 0,
    }
