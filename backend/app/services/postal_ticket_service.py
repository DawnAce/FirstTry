"""邮局客服工单统一查询与类型分发。"""

from datetime import date
from typing import List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy import and_, case, func, or_
from sqlalchemy.orm import Session

from app.models import PostalTicket, PostalTicketType

TICKET_TYPES = tuple(t.value for t in PostalTicketType)


def _year_of(rec: PostalTicket) -> Optional[int]:
    if rec.year:
        return rec.year
    if rec.external_order_no and "-" in rec.external_order_no:
        head = rec.external_order_no.split("-", 1)[0]
        if head.isdigit():
            return int(head)
    dt = _ticket_date(rec)
    return dt.year if dt else None


def _delivery_no(external_order_no: Optional[str]) -> Optional[str]:
    if external_order_no and "-" in external_order_no:
        return external_order_no.split("-", 1)[1]
    return external_order_no


def _type_value(rec: PostalTicket) -> str:
    return rec.type.value if hasattr(rec.type, "value") else str(rec.type)


def _ticket_date(rec: PostalTicket):
    type_value = _type_value(rec)
    if type_value == PostalTicketType.complaint.value:
        return rec.complaint_date
    if type_value == PostalTicketType.address.value:
        return rec.change_date
    return rec.follow_up_date


def _addr_status(rec: PostalTicket) -> str:
    if rec.applied_to_order:
        return "applied"
    return "pending" if rec.postal_delivery_id else "unmatched"


def _row(rec: PostalTicket) -> dict:
    type_value = _type_value(rec)
    if type_value == PostalTicketType.complaint.value:
        name = rec.snap_name
        summary = rec.missing_issues
        status = rec.status.value if rec.status else None
        handling_count = rec.handling_count
        applied_to_order = None
    elif type_value == PostalTicketType.address.value:
        name = rec.new_name or rec.old_name
        summary = rec.new_address
        status = _addr_status(rec)
        handling_count = None
        applied_to_order = rec.applied_to_order
    else:
        name = rec.snap_name
        summary = rec.result
        status = None
        handling_count = None
        applied_to_order = None
    return {
        "type": type_value,
        "id": rec.id,
        "year": _year_of(rec),
        "delivery_no": _delivery_no(rec.external_order_no),
        "recipient_name": name,
        "postal_delivery_id": rec.postal_delivery_id,
        "order_id": rec.order_id,
        "ticket_date": _ticket_date(rec),
        "summary": summary or None,
        "status": status,
        "handling_count": handling_count,
        "applied_to_order": applied_to_order,
    }


def _ticket_date_expr():
    return case(
        (PostalTicket.type == PostalTicketType.complaint, PostalTicket.complaint_date),
        (PostalTicket.type == PostalTicketType.address, PostalTicket.change_date),
        else_=PostalTicket.follow_up_date,
    )


def _base_query(
    db: Session,
    *,
    year: Optional[int],
    search: Optional[str],
):
    # parent_ticket_id 非空的回访已经并入投诉时间线，不作为独立工单重复展示。
    q = db.query(PostalTicket).filter(PostalTicket.parent_ticket_id.is_(None))
    if year:
        q = q.filter(or_(
            PostalTicket.year == year,
            PostalTicket.external_order_no.like(f"{year}-%"),
            and_(
                _ticket_date_expr() >= date(year, 1, 1),
                _ticket_date_expr() < date(year + 1, 1, 1),
            ),
        ))
    if search and search.strip():
        s = search.strip()
        q = q.filter(or_(
            PostalTicket.snap_name.contains(s),
            PostalTicket.old_name.contains(s),
            PostalTicket.new_name.contains(s),
            PostalTicket.external_order_no.contains(s),
        ))
    return q


def get_ticket(db: Session, ticket_id: int) -> PostalTicket:
    rec = db.query(PostalTicket).filter(PostalTicket.id == ticket_id).first()
    if rec is None:
        raise HTTPException(status_code=404, detail=f"客服工单 {ticket_id} 不存在")
    return rec


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
    """返回当前页工单、匹配总数和忽略状态筛选的各类型计数。"""
    q = _base_query(db, year=year, search=search)
    if type:
        q = q.filter(PostalTicket.type == PostalTicketType(type))
    if status:
        if type == PostalTicketType.complaint.value:
            q = q.filter(PostalTicket.status == status)
        elif type is None:
            q = q.filter(or_(
                PostalTicket.type != PostalTicketType.complaint,
                PostalTicket.status == status,
            ))
    if applied is not None:
        if type == PostalTicketType.address.value:
            q = q.filter(PostalTicket.applied_to_order.is_(applied))
        elif type is None:
            q = q.filter(or_(
                PostalTicket.type != PostalTicketType.address,
                PostalTicket.applied_to_order.is_(applied),
            ))

    total = q.count()
    rows = (
        q.order_by(_ticket_date_expr().desc(), PostalTicket.id.desc())
        .offset(max(0, (page - 1) * page_size))
        .limit(page_size)
        .all()
    )

    summary_rows = (
        _base_query(db, year=year, search=search)
        .with_entities(PostalTicket.type, func.count(PostalTicket.id))
        .group_by(PostalTicket.type)
        .all()
    )
    summary = {ticket_type: 0 for ticket_type in TICKET_TYPES}
    for ticket_type, count in summary_rows:
        key = ticket_type.value if hasattr(ticket_type, "value") else str(ticket_type)
        summary[key] = int(count)
    return [_row(rec) for rec in rows], total, summary
