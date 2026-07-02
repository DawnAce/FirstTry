"""邮局收款/发票 · 只读列表（筛选 + 分页）。"""

from typing import List, Optional, Tuple

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models import PostalFinance


def list_finance(
    db: Session,
    *,
    platform: Optional[str] = None,
    tax_category: Optional[str] = None,
    linked: Optional[bool] = None,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
) -> Tuple[List[PostalFinance], int]:
    q = db.query(PostalFinance)
    if platform:
        q = q.filter(PostalFinance.platform == platform)
    if tax_category:
        q = q.filter(PostalFinance.tax_category == tax_category)
    if linked is not None:
        q = q.filter(PostalFinance.order_id.isnot(None) if linked else PostalFinance.order_id.is_(None))
    if search and search.strip():
        s = search.strip()
        q = q.filter(or_(
            PostalFinance.payer_name.contains(s),
            PostalFinance.buyer_title.contains(s),
            PostalFinance.external_order_no.contains(s),
        ))
    total = q.count()
    rows = (
        q.order_by(PostalFinance.collected_at.desc(), PostalFinance.id.desc())
        .offset(max(0, (page - 1) * page_size)).limit(page_size).all()
    )
    return rows, total
