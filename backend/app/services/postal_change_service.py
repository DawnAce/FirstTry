"""邮局改地址 / 回访 · 列表 + 回流动作。"""

from datetime import date, datetime
from typing import List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.models import (
    FulfillmentAllocation,
    FulfillmentTarget,
    OrderItem,
    PostalAddressChange,
    PostalFollowUp,
    TargetStatus,
)


def list_address_changes(
    db: Session,
    *,
    year: Optional[int] = None,
    applied: Optional[bool] = None,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
) -> Tuple[List[PostalAddressChange], int]:
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
    total = q.count()
    rows = (
        q.order_by(PostalAddressChange.change_date.desc(), PostalAddressChange.id.desc())
        .offset(max(0, (page - 1) * page_size)).limit(page_size).all()
    )
    return rows, total


def list_follow_ups(
    db: Session,
    *,
    year: Optional[int] = None,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
) -> Tuple[List[PostalFollowUp], int]:
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
    total = q.count()
    rows = (
        q.order_by(PostalFollowUp.follow_up_date.desc(), PostalFollowUp.id.desc())
        .offset(max(0, (page - 1) * page_size)).limit(page_size).all()
    )
    return rows, total


def _current_target(db: Session, order_id: int) -> Optional[FulfillmentTarget]:
    return (
        db.query(FulfillmentTarget)
        .join(OrderItem, FulfillmentTarget.order_item_id == OrderItem.id)
        .join(FulfillmentAllocation, FulfillmentTarget.allocation_id == FulfillmentAllocation.id)
        .filter(OrderItem.order_id == order_id)
        .filter(FulfillmentTarget.status == TargetStatus.active)
        .filter(FulfillmentAllocation.effective_until_issue.is_(None))
        .order_by(FulfillmentTarget.id)
        .first()
    )


def apply_address_change(db: Session, change_id: int, operator_id: Optional[int] = None) -> PostalAddressChange:
    """回流：把改地址的新姓名/电话/地址写回订单当前收报人，之后的批次即用新地址。"""
    ac = (
        db.query(PostalAddressChange)
        .filter(PostalAddressChange.id == change_id)
        .with_for_update()
        .first()
    )
    if ac is None:
        raise HTTPException(status_code=404, detail=f"改地址工单 {change_id} 不存在")
    if ac.applied_to_order:
        raise HTTPException(status_code=409, detail="该改地址已回流，请勿重复")
    if not ac.order_id:
        raise HTTPException(status_code=400, detail="未挂到订单，无法回流（先补齐编号/导入读者）")
    target = _current_target(db, ac.order_id)
    if target is None:
        raise HTTPException(status_code=400, detail="订单没有可更新的当前收报人目标")

    if ac.new_name:
        target.recipient_name = ac.new_name
    if ac.new_phone:
        target.recipient_phone = ac.new_phone
    if ac.new_address:
        target.recipient_address = ac.new_address
    ac.applied_to_order = True
    ac.applied_by = operator_id
    ac.applied_at = datetime.now()
    db.commit()
    db.refresh(ac)
    return ac
