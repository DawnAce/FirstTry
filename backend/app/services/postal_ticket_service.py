"""邮局客服工单 · 统一聚合读取（投诉 / 改地址 / 回访 三类归一为「工单」）。

只做**列表呈现**的聚合：把三张表规整成统一的 TicketRow（类型 + 收报人 + 编号 +
摘要 + 状态 + 日期 + 关联）。详情 / 编辑 / 应用 / 处理仍走各自现有接口，三表不合并
（物理合表见后续 PR）。数据量为邮局量级，聚合与分页在内存完成。
"""

from datetime import date
from typing import List, Optional, Tuple

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.models import (
    PostalAddressChange,
    PostalComplaint,
    PostalFollowUp,
)

TICKET_TYPES = ("complaint", "address", "follow")


def _year_of(external_order_no: Optional[str], d: Optional[date]) -> Optional[int]:
    if external_order_no and "-" in external_order_no:
        head = external_order_no.split("-", 1)[0]
        if head.isdigit():
            return int(head)
    return d.year if d else None


def _delivery_no(external_order_no: Optional[str]) -> Optional[str]:
    if external_order_no and "-" in external_order_no:
        return external_order_no.split("-", 1)[1]
    return external_order_no


def _addr_status(rec: PostalAddressChange) -> str:
    if rec.applied_to_order:
        return "applied"
    return "pending" if rec.postal_delivery_id else "unmatched"


def _row(*, type_, id, ext, dt, name, summary, status, postal_delivery_id,
         order_id, handling_count=None, applied_to_order=None) -> dict:
    return {
        "type": type_,
        "id": id,
        "year": _year_of(ext, dt),
        "delivery_no": _delivery_no(ext),
        "recipient_name": name,
        "postal_delivery_id": postal_delivery_id,
        "order_id": order_id,
        "ticket_date": dt,
        "summary": (summary or None),
        "status": status,
        "handling_count": handling_count,
        "applied_to_order": applied_to_order,
        "_sort": (dt or date.min, id),
    }


def _complaints(db, *, year, search, status) -> List[dict]:
    q = db.query(PostalComplaint)
    if year:
        q = q.filter(or_(
            PostalComplaint.external_order_no.like(f"{year}-%"),
            PostalComplaint.year == year,
            and_(PostalComplaint.complaint_date >= date(year, 1, 1),
                 PostalComplaint.complaint_date < date(year + 1, 1, 1)),
        ))
    if status:
        q = q.filter(PostalComplaint.status == status)
    if search and search.strip():
        s = search.strip()
        q = q.filter(or_(
            PostalComplaint.snap_name.contains(s),
            PostalComplaint.external_order_no.contains(s),
        ))
    return [
        _row(type_="complaint", id=c.id, ext=c.external_order_no, dt=c.complaint_date,
             name=c.snap_name, summary=c.missing_issues,
             status=(c.status.value if c.status else None),
             postal_delivery_id=c.postal_delivery_id, order_id=c.order_id,
             handling_count=c.handling_count)
        for c in q.all()
    ]


def _addresses(db, *, year, search, applied) -> List[dict]:
    q = db.query(PostalAddressChange)
    if year:
        q = q.filter(or_(
            PostalAddressChange.external_order_no.like(f"{year}-%"),
            and_(PostalAddressChange.change_date >= date(year, 1, 1),
                 PostalAddressChange.change_date < date(year + 1, 1, 1)),
        ))
    if applied is not None:
        q = q.filter(PostalAddressChange.applied_to_order.is_(applied))
    if search and search.strip():
        s = search.strip()
        q = q.filter(or_(
            PostalAddressChange.old_name.contains(s),
            PostalAddressChange.new_name.contains(s),
            PostalAddressChange.external_order_no.contains(s),
        ))
    return [
        _row(type_="address", id=a.id, ext=a.external_order_no, dt=a.change_date,
             name=(a.new_name or a.old_name), summary=a.new_address,
             status=_addr_status(a), postal_delivery_id=a.postal_delivery_id,
             order_id=a.order_id, applied_to_order=a.applied_to_order)
        for a in q.all()
    ]


def _follows(db, *, year, search) -> List[dict]:
    q = db.query(PostalFollowUp)
    if year:
        q = q.filter(or_(
            PostalFollowUp.external_order_no.like(f"{year}-%"),
            and_(PostalFollowUp.follow_up_date >= date(year, 1, 1),
                 PostalFollowUp.follow_up_date < date(year + 1, 1, 1)),
        ))
    if search and search.strip():
        s = search.strip()
        q = q.filter(or_(
            PostalFollowUp.snap_name.contains(s),
            PostalFollowUp.external_order_no.contains(s),
        ))
    return [
        _row(type_="follow", id=f.id, ext=f.external_order_no, dt=f.follow_up_date,
             name=f.snap_name, summary=f.result, status=None,
             postal_delivery_id=f.postal_delivery_id, order_id=f.order_id)
        for f in q.all()
    ]


def list_tickets(
    db: Session,
    *,
    type: Optional[str] = None,
    year: Optional[int] = None,
    status: Optional[str] = None,
    applied: Optional[bool] = None,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
) -> Tuple[List[dict], int, dict]:
    """返回 (当前页工单行, 匹配总数, 各类型计数)。type 缺省=全部三类。"""
    rows: List[dict] = []
    if type in (None, "complaint"):
        rows += _complaints(db, year=year, search=search, status=status)
    if type in (None, "address"):
        rows += _addresses(db, year=year, search=search, applied=applied)
    if type in (None, "follow"):
        rows += _follows(db, year=year, search=search)

    rows.sort(key=lambda r: r["_sort"], reverse=True)
    total = len(rows)
    start = max(0, (page - 1) * page_size)
    page_rows = rows[start:start + page_size]
    for r in page_rows:
        r.pop("_sort", None)

    # 各类型计数（年度 + 搜索口径，忽略类型/状态/应用筛选）——供 UI 分段筛选显示。
    summary = {
        "complaint": len(_complaints(db, year=year, search=search, status=None)),
        "address": len(_addresses(db, year=year, search=search, applied=None)),
        "follow": len(_follows(db, year=year, search=search)),
    }
    return page_rows, total, summary
