"""邮局投递 · 投递明细（全部投递记录）列表 —— 筛选 + 分页。

邮局记录不进「订单列表 / 客户管理」，这里是它们完整名册的家。
"""

from datetime import date, timedelta
from typing import List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.models import (
    PostalDelivery,
)
from app.models.postal_delivery import PostalDeliverySourceType
from app.services import postal_common as pc

DELIVERY_STATUSES = {"pending", "active", "expiring", "completed"}
EXPIRING_DAYS = 30


def _deliveries_query(
    db: Session,
    *,
    order_id: Optional[int] = None,
    year: Optional[int] = None,
    channel: Optional[str] = None,
    distribution_unit_id: Optional[int] = None,
    month: Optional[int] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
):
    q = db.query(PostalDelivery).filter(PostalDelivery.is_archived.is_(False))
    if order_id:
        q = q.filter(PostalDelivery.order_id == order_id)
    if year:
        q = q.filter(PostalDelivery.year == year)
    if channel and channel.strip():
        q = q.filter(PostalDelivery.source_channel.contains(channel.strip()))
    if distribution_unit_id:
        q = q.filter(PostalDelivery.distribution_unit_id == distribution_unit_id)
    if year and month and 1 <= month <= 12:
        # 起投月：coverage_start_date ∈ [当月1号, 次月1号)。
        month_start = date(year, month, 1)
        month_end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
        q = q.filter(
            PostalDelivery.coverage_start_date >= month_start,
            PostalDelivery.coverage_start_date < month_end,
        )
    if status:
        if status not in DELIVERY_STATUSES:
            raise HTTPException(status_code=400, detail=f"未知投递状态：{status}")
        today = date.today()
        expiring_end = today + timedelta(days=EXPIRING_DAYS)
        start = PostalDelivery.coverage_start_date
        end = PostalDelivery.coverage_end_date
        if status == "completed":
            q = q.filter(end < today)
        elif status == "pending":
            q = q.filter(start > today, or_(end.is_(None), end >= today))
        elif status == "expiring":
            q = q.filter(end >= today, end <= expiring_end, or_(start.is_(None), start <= today))
        else:
            q = q.filter(
                or_(start.is_not(None), end.is_not(None)),
                or_(end.is_(None), end >= today),
                or_(start.is_(None), start <= today),
                or_(end.is_(None), end > expiring_end),
            )
    if search and search.strip():
        s = search.strip()
        matches = [
            PostalDelivery.recipient_name.contains(s),
            PostalDelivery.delivery_no.contains(s),
            PostalDelivery.recipient_phone.contains(s),
            PostalDelivery.recipient_address.contains(s),
            PostalDelivery.recipient_postal_code.contains(s),
            PostalDelivery.external_order_no.contains(s),
        ]
        if s.isdigit():
            matches.append(PostalDelivery.delivery_no == pc.norm_no(s))
        year_text, separator, number_text = s.replace("－", "-").partition("-")
        number = pc.norm_no(number_text) if separator else None
        if len(year_text) == 4 and year_text.isdigit() and number:
            matches.append(and_(
                PostalDelivery.year == int(year_text),
                PostalDelivery.delivery_no == number,
            ))
        q = q.filter(or_(*matches))
    return q


def list_deliveries(
    db: Session,
    *,
    order_id: Optional[int] = None,
    year: Optional[int] = None,
    channel: Optional[str] = None,
    distribution_unit_id: Optional[int] = None,
    month: Optional[int] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
) -> Tuple[List[PostalDelivery], int]:
    q = _deliveries_query(
        db, order_id=order_id, year=year, channel=channel,
        distribution_unit_id=distribution_unit_id, month=month, status=status, search=search,
    )
    total = q.count()
    order = (
        (PostalDelivery.coverage_end_date.asc(), PostalDelivery.id.desc())
        if status == "expiring"
        else (PostalDelivery.year.desc(), PostalDelivery.id.desc())
    )
    rows = (
        q.order_by(*order)
        .offset(max(0, (page - 1) * page_size))
        .limit(page_size)
        .all()
    )
    return rows, total


def summarize_deliveries(
    db: Session,
    *,
    order_id: Optional[int] = None,
    year: Optional[int] = None,
    channel: Optional[str] = None,
    distribution_unit_id: Optional[int] = None,
    month: Optional[int] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
) -> dict:
    """概览行：合计份数 / 投递单位数 / 未填投递单位条数（同筛选口径）。"""
    q = _deliveries_query(
        db, order_id=order_id, year=year, channel=channel,
        distribution_unit_id=distribution_unit_id, month=month, status=status, search=search,
    )
    total_copies = q.with_entities(func.coalesce(func.sum(PostalDelivery.copies), 0)).scalar() or 0
    unit_count = q.with_entities(func.count(func.distinct(PostalDelivery.distribution_unit_id))).scalar() or 0
    missing_unit_count = q.filter(PostalDelivery.distribution_unit_id.is_(None)).count()
    return {
        "total_copies": int(total_copies),
        "unit_count": int(unit_count),
        "missing_unit_count": int(missing_unit_count),
        "nearest_expiry_date": (
            q.with_entities(func.min(PostalDelivery.coverage_end_date)).scalar()
            if status == "expiring" else None
        ),
    }


# --- 手工 CRUD --------------------------------------------------------

def create_delivery(db: Session, payload: dict, operator_id: Optional[int] = None) -> PostalDelivery:
    """手工新增一条投递记录；来源单号可唯一匹配时立即挂订单。"""
    d = dict(payload)
    year = d["year"]
    raw_no = d.get("delivery_no") or ""
    no = pc.norm_no(raw_no)
    if not no:
        raise HTTPException(status_code=400, detail="编号必须为数字且不能为空")
    d["delivery_no"] = no
    d["external_order_no"] = (d.get("external_order_no") or "").strip() or None
    exists = (
        db.query(PostalDelivery.id)
        .filter(PostalDelivery.year == year, PostalDelivery.delivery_no == no)
        .first()
    )
    if exists:
        raise HTTPException(status_code=409, detail=f"编号 {year}-{no} 已存在")
    d["source_type"] = PostalDeliverySourceType.manual
    d["order_id"] = None
    d["created_by"] = operator_id
    rec = PostalDelivery(**d)
    db.add(rec)
    db.flush()
    from app.services.postal_renewal_service import try_link_delivery_exact

    try_link_delivery_exact(db, rec)
    db.commit()
    db.refresh(rec)
    return rec


def update_delivery(db: Session, delivery_id: int, patch: dict) -> PostalDelivery:
    rec = db.query(PostalDelivery).filter(PostalDelivery.id == delivery_id).first()
    if rec is None:
        raise HTTPException(status_code=404, detail=f"投递记录 {delivery_id} 不存在")
    patch = dict(patch)
    source_no_changed = "external_order_no" in patch
    if source_no_changed:
        patch["external_order_no"] = (patch.get("external_order_no") or "").strip() or None
    if "delivery_no" in patch:
        raw = patch["delivery_no"] or ""
        no = pc.norm_no(raw)
        if not no:
            raise HTTPException(status_code=400, detail="编号必须为数字且不能为空")
        patch["delivery_no"] = no
    # 必填列显式传 null 视为「不修改」，避免落到 NOT NULL 列触发 500。
    for req in ("year", "recipient_name", "recipient_address", "copies"):
        if req in patch and patch[req] is None:
            patch.pop(req)
    new_year = patch.get("year", rec.year)
    new_no = patch.get("delivery_no", rec.delivery_no)
    if new_year != rec.year or new_no != rec.delivery_no:
        dup = (
            db.query(PostalDelivery.id)
            .filter(
                PostalDelivery.year == new_year,
                PostalDelivery.delivery_no == new_no,
                PostalDelivery.id != delivery_id,
            )
            .first()
        )
        if dup:
            raise HTTPException(status_code=409, detail=f"编号 {new_year}-{new_no} 已存在")
    for k, v in patch.items():
        setattr(rec, k, v)
    if source_no_changed:
        # 来源单号是正式关联的业务键；修改或清空后不能保留旧订单关系。
        rec.order_id = None
        rec.order_item_id = None
        rec.fulfillment_target_id = None
    db.flush()
    from app.services.postal_renewal_service import try_link_delivery_exact

    if rec.order_id is None:
        try_link_delivery_exact(db, rec)
    db.commit()
    db.refresh(rec)
    return rec


def delete_delivery(db: Session, delivery_id: int) -> None:
    """删除投递记录。"""
    rec = db.query(PostalDelivery).filter(PostalDelivery.id == delivery_id).first()
    if rec is None:
        raise HTTPException(status_code=404, detail=f"投递记录 {delivery_id} 不存在")
    db.delete(rec)
    db.commit()
