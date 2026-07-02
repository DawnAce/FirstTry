"""邮局投诉工单 · 只读列表（筛选 + 分页）。"""

from typing import List, Optional, Tuple

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models import PostalComplaint, PostalComplaintStatus


def list_complaints(
    db: Session,
    *,
    year: Optional[int] = None,
    status: Optional[str] = None,
    distribution_unit_id: Optional[int] = None,
    min_handling_count: Optional[int] = None,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
) -> Tuple[List[PostalComplaint], int]:
    q = db.query(PostalComplaint)
    if year:
        q = q.filter(PostalComplaint.year == year)
    if status:
        q = q.filter(PostalComplaint.status == PostalComplaintStatus(status))
    if distribution_unit_id:
        q = q.filter(PostalComplaint.routed_unit_id == distribution_unit_id)
    if min_handling_count:
        q = q.filter(PostalComplaint.handling_count >= min_handling_count)
    if search and search.strip():
        s = search.strip()
        q = q.filter(
            or_(
                PostalComplaint.snap_name.contains(s),
                PostalComplaint.external_order_no.contains(s),
            )
        )
    total = q.count()
    rows = (
        q.order_by(PostalComplaint.complaint_date.desc(), PostalComplaint.id.desc())
        .offset(max(0, (page - 1) * page_size))
        .limit(page_size)
        .all()
    )
    return rows, total
