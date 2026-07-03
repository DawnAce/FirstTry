"""邮局投递 · 投递名册（全部投递记录）列表 —— 筛选 + 分页。

邮局记录不进「订单列表 / 客户管理」，这里是它们完整名册的家。
"""

from datetime import date
from typing import List, Optional, Tuple

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models import PostalDelivery


def list_deliveries(
    db: Session,
    *,
    year: Optional[int] = None,
    channel: Optional[str] = None,
    distribution_unit_id: Optional[int] = None,
    month: Optional[int] = None,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
) -> Tuple[List[PostalDelivery], int]:
    q = db.query(PostalDelivery)
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
    if search and search.strip():
        s = search.strip()
        q = q.filter(or_(
            PostalDelivery.recipient_name.contains(s),
            PostalDelivery.delivery_no.contains(s),
        ))
    total = q.count()
    rows = (
        q.order_by(PostalDelivery.year.desc(), PostalDelivery.id.desc())
        .offset(max(0, (page - 1) * page_size))
        .limit(page_size)
        .all()
    )
    return rows, total
