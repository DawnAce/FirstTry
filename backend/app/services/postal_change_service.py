"""邮局改地址 / 回访 · 列表 + 回流动作。"""

from datetime import date, datetime
from typing import List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.models import (
    FulfillmentAllocation,
    FulfillmentTarget,
    OrderItem,
    PostalAddressChange,
    PostalDelivery,
    PostalFollowUp,
    TargetStatus,
)
from app.services.address_service import normalize_address
from app.services import postal_common as pc


def _addr_query(
    db: Session,
    *,
    year: Optional[int] = None,
    applied: Optional[bool] = None,
    search: Optional[str] = None,
):
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
    return q


def list_address_changes(
    db: Session,
    *,
    year: Optional[int] = None,
    applied: Optional[bool] = None,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
) -> Tuple[List[PostalAddressChange], int]:
    q = _addr_query(db, year=year, applied=applied, search=search)
    total = q.count()
    rows = (
        q.order_by(PostalAddressChange.change_date.desc(), PostalAddressChange.id.desc())
        .offset(max(0, (page - 1) * page_size)).limit(page_size).all()
    )
    return rows, total


def get_address_change(db: Session, change_id: int) -> PostalAddressChange:
    rec = db.query(PostalAddressChange).filter(PostalAddressChange.id == change_id).first()
    if rec is None:
        raise HTTPException(status_code=404, detail=f"改地址工单 {change_id} 不存在")
    return rec


def summarize_address_changes(
    db: Session,
    *,
    year: Optional[int] = None,
    search: Optional[str] = None,
) -> dict:
    """概览行：待应用（已关联未应用）/ 未匹配 / 已应用（忽略应用状态筛选）。"""
    q = _addr_query(db, year=year, applied=None, search=search)
    applied = q.filter(PostalAddressChange.applied_to_order.is_(True)).count()
    pending_apply = q.filter(
        PostalAddressChange.applied_to_order.is_(False),
        PostalAddressChange.postal_delivery_id.isnot(None),
    ).count()
    unmatched = q.filter(
        PostalAddressChange.applied_to_order.is_(False),
        PostalAddressChange.postal_delivery_id.is_(None),
    ).count()
    return {"pending_apply": pending_apply, "unmatched": unmatched, "applied": applied}


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


def get_follow_up(db: Session, follow_id: int) -> PostalFollowUp:
    rec = db.query(PostalFollowUp).filter(PostalFollowUp.id == follow_id).first()
    if rec is None:
        raise HTTPException(status_code=404, detail=f"回访记录 {follow_id} 不存在")
    return rec


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
    """应用新地址：把新姓名/电话/地址写回**投递记录**，之后的月度明细即用新地址。

    投递记录若挂了真实订单，一并更新订单当前收报人。无关联订单也能应用（写投递记录即可）；
    但必须先关联到一条投递记录（未匹配则无处可写、报错提示先导入读者名册）。
    """
    ac = (
        db.query(PostalAddressChange)
        .filter(PostalAddressChange.id == change_id)
        .with_for_update()
        .first()
    )
    if ac is None:
        raise HTTPException(status_code=404, detail=f"改地址工单 {change_id} 不存在")
    if ac.applied_to_order:
        raise HTTPException(status_code=409, detail="该改地址已应用，请勿重复")
    if not ac.postal_delivery_id:
        raise HTTPException(
            status_code=400,
            detail="未关联到投递记录，无法应用（请先导入该编号所在的读者名册）",
        )
    rec = (
        db.query(PostalDelivery)
        .filter(PostalDelivery.id == ac.postal_delivery_id)
        .with_for_update()
        .first()
    )
    if rec is None:
        raise HTTPException(status_code=400, detail="关联的投递记录不存在")

    # 写回投递记录（下一版月度明细即用新地址）。
    if ac.new_name:
        rec.recipient_name = ac.new_name
    if ac.new_phone:
        rec.recipient_phone = ac.new_phone
    if ac.new_address:
        rec.recipient_address = ac.new_address
        try:
            parsed = normalize_address(ac.new_address)
            rec.recipient_province = parsed.get("province") or None
            rec.recipient_city = parsed.get("city") or None
            rec.recipient_district = parsed.get("district") or None
        except Exception:  # cpca 偶发解析异常不阻断应用
            pass
    if ac.new_copies is not None:
        rec.copies = ac.new_copies

    # 投递记录挂了真实订单 → 一并更新订单当前收报人。
    if rec.order_id:
        target = _current_target(db, rec.order_id)
        if target is not None:
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


# --- 手工 CRUD：改地址 -----------------------------------------------

def create_address_change(db: Session, payload: dict, operator_id: Optional[int] = None) -> PostalAddressChange:
    """手工新增改地址工单（未应用）。复用编号+年度关联投递记录、routed_label 归一。"""
    d = dict(payload)
    year = d.pop("year", None)
    delivery_no = d.pop("delivery_no", None)
    external, pd_id, order_id = pc.link_delivery(db, year, delivery_no)
    handling = d.get("handling")
    rec = PostalAddressChange(
        postal_delivery_id=pd_id,
        order_id=order_id,
        external_order_no=external,
        routed_label=pc.routed_label(handling) if handling else None,
        applied_to_order=False,
        **d,
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec


def update_address_change(db: Session, change_id: int, patch: dict) -> PostalAddressChange:
    rec = db.query(PostalAddressChange).filter(PostalAddressChange.id == change_id).first()
    if rec is None:
        raise HTTPException(status_code=404, detail=f"改地址工单 {change_id} 不存在")
    patch = dict(patch)
    relink = "delivery_no" in patch
    year = patch.pop("year", None)          # year 不是本表列，仅用于关联
    delivery_no = patch.pop("delivery_no", None)
    if relink:
        external, pd_id, order_id = pc.link_delivery(db, year, delivery_no)
        rec.external_order_no = external
        rec.postal_delivery_id = pd_id
        rec.order_id = order_id
    if "handling" in patch:
        rec.routed_label = pc.routed_label(patch["handling"]) if patch["handling"] else None
    for k, v in patch.items():
        setattr(rec, k, v)
    db.commit()
    db.refresh(rec)
    return rec


def delete_address_change(db: Session, change_id: int) -> None:
    rec = db.query(PostalAddressChange).filter(PostalAddressChange.id == change_id).first()
    if rec is None:
        raise HTTPException(status_code=404, detail=f"改地址工单 {change_id} 不存在")
    db.delete(rec)
    db.commit()


# --- 手工 CRUD：回访 -------------------------------------------------

def create_follow_up(db: Session, payload: dict, operator_id: Optional[int] = None) -> PostalFollowUp:
    d = dict(payload)
    year = d.pop("year", None)
    delivery_no = d.pop("delivery_no", None)
    external, pd_id, order_id = pc.link_delivery(db, year, delivery_no)
    rec = PostalFollowUp(
        postal_delivery_id=pd_id, order_id=order_id, external_order_no=external, **d
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec


def update_follow_up(db: Session, follow_id: int, patch: dict) -> PostalFollowUp:
    rec = db.query(PostalFollowUp).filter(PostalFollowUp.id == follow_id).first()
    if rec is None:
        raise HTTPException(status_code=404, detail=f"回访记录 {follow_id} 不存在")
    patch = dict(patch)
    relink = "delivery_no" in patch
    year = patch.pop("year", None)
    delivery_no = patch.pop("delivery_no", None)
    if relink:
        external, pd_id, order_id = pc.link_delivery(db, year, delivery_no)
        rec.external_order_no = external
        rec.postal_delivery_id = pd_id
        rec.order_id = order_id
    for k, v in patch.items():
        setattr(rec, k, v)
    db.commit()
    db.refresh(rec)
    return rec


def delete_follow_up(db: Session, follow_id: int) -> None:
    rec = db.query(PostalFollowUp).filter(PostalFollowUp.id == follow_id).first()
    if rec is None:
        raise HTTPException(status_code=404, detail=f"回访记录 {follow_id} 不存在")
    db.delete(rec)
    db.commit()
