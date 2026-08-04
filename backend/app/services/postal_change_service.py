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
    PostalComplaint,
    PostalComplaintHandlingRecord,
    PostalDelivery,
    PostalFollowUp,
    PostalTicketEventType,
    ShippingChannel,
    TargetStatus,
)
from app.services.address_service import normalize_address
from app.services import postal_common as pc

_MISSING = object()


def _start_date(rec: PostalAddressChange, raw: Optional[str]) -> Optional[str]:
    """把旧表的 MMDD 起月日转换成可展示的完整日期。"""
    if not raw:
        return None
    text = str(raw).strip().replace("-", "").replace("/", "")
    year = rec.year or (rec.change_date.year if rec.change_date else None)
    if len(text) == 8 and text.isdigit():
        year, month, day = int(text[:4]), int(text[4:6]), int(text[6:])
    elif len(text) == 4 and text.isdigit() and year:
        month, day = int(text[:2]), int(text[2:])
    else:
        return None
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def address_change_allocations(rec: PostalAddressChange) -> list[dict]:
    """兼容旧工单：没有显式去向时，按旧/新份数推导，差额视为待确认。"""
    if rec.copy_allocations is not None:
        return list(rec.copy_allocations)

    old_copies = max(rec.old_copies or 0, 0)
    new_copies = old_copies if rec.new_copies is None else max(rec.new_copies, 0)
    rows = []
    if new_copies:
        rows.append({
            "kind": "changed",
            "copies": new_copies,
            "name": rec.new_name or rec.old_name,
            "phone": rec.new_phone or rec.old_phone,
            "address": rec.new_address or rec.old_address,
            "start_date": _start_date(rec, rec.effective_start_month),
        })
    remainder = max(old_copies - new_copies, 0)
    if remainder:
        rows.append({
            "kind": "pending",
            "copies": remainder,
            "name": rec.old_name,
            "phone": rec.old_phone,
            "address": rec.old_address,
            "start_date": _start_date(rec, rec.original_start_month),
        })
    return rows


def address_allocation_summary(rec: PostalAddressChange) -> Optional[str]:
    rows = address_change_allocations(rec)
    if not rows:
        return None
    total = rec.old_copies if rec.old_copies is not None else sum(r["copies"] for r in rows)
    destinations = " + ".join(
        f"{'待确认' if row['kind'] == 'pending' else (row.get('name') or '未命名')}"
        f"{row['copies']}份"
        for row in rows
    )
    return f"原{total}份 → {destinations}"


def _normalise_allocations(rec: PostalAddressChange, rows) -> list[dict]:
    normalised = []
    for raw in rows or []:
        row = raw.model_dump() if hasattr(raw, "model_dump") else dict(raw)
        kind = row["kind"]
        if kind == "retained" or kind == "pending":
            row["name"] = row.get("name") or rec.old_name
            row["phone"] = row.get("phone") or rec.old_phone
            row["address"] = row.get("address") or rec.old_address
        else:
            row["name"] = row.get("name") or rec.new_name or rec.old_name
            row["phone"] = row.get("phone") or rec.new_phone or rec.old_phone
            row["address"] = row.get("address") or rec.new_address or rec.old_address
        start = row.get("start_date")
        if not start and kind in {"retained", "pending"}:
            start = _start_date(rec, rec.original_start_month)
        row["start_date"] = start.isoformat() if hasattr(start, "isoformat") else start
        normalised.append(row)
    if rec.old_copies is not None and sum(row["copies"] for row in normalised) != rec.old_copies:
        raise HTTPException(status_code=400, detail="各去向份数合计必须等于原份数")
    return normalised


def _sync_allocations(rec: PostalAddressChange, rows=None) -> None:
    if rows is not None:
        rec.copy_allocations = _normalise_allocations(rec, rows)
    rec.unresolved_copies = sum(
        row["copies"] for row in address_change_allocations(rec)
        if row["kind"] == "pending"
    )


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
            and_(PostalAddressChange.change_date >= datetime(year, 1, 1),
                 PostalAddressChange.change_date < datetime(year + 1, 1, 1)),
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
        raise HTTPException(status_code=404, detail=f"收件信息变更工单 {change_id} 不存在")
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
    q = db.query(PostalFollowUp).filter(PostalFollowUp.parent_ticket_id.is_(None))
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


def sync_follow_up_timeline(
    db: Session,
    rec: PostalFollowUp,
    *,
    operator_id: Optional[int] = None,
) -> None:
    """有同编号投诉时把回访挂入其时间线，否则保留为独立回访工单。"""
    if rec.id is None:
        db.flush()
    complaint = None
    if rec.external_order_no:
        complaint = (
            db.query(PostalComplaint)
            .filter(PostalComplaint.external_order_no == rec.external_order_no)
            .order_by(PostalComplaint.complaint_date.desc(), PostalComplaint.id.desc())
            .first()
        )
    event = (
        db.query(PostalComplaintHandlingRecord)
        .filter(PostalComplaintHandlingRecord.source_ticket_id == rec.id)
        .first()
    )
    if complaint is None:
        rec.parent_ticket_id = None
        if event is not None:
            db.delete(event)
        return

    rec.parent_ticket_id = complaint.id
    handled_at = (
        datetime.combine(rec.follow_up_date, datetime.min.time())
        if rec.follow_up_date else datetime.now()
    )
    if event is None:
        event = PostalComplaintHandlingRecord(
            ticket_id=complaint.id,
            source_ticket_id=rec.id,
            event_type=PostalTicketEventType.follow_up,
            handled_by=operator_id,
            action=rec.communication_content or rec.batch_label or "回访",
            follow_result=rec.result,
        )
        db.add(event)
    else:
        event.ticket_id = complaint.id
        event.action = rec.communication_content or rec.batch_label or "回访"
        event.follow_result = rec.result
    event.handled_at = handled_at


def _current_targets_query(db: Session, delivery: PostalDelivery):
    q = (
        db.query(FulfillmentTarget)
        .join(OrderItem, FulfillmentTarget.order_item_id == OrderItem.id)
        .join(FulfillmentAllocation, FulfillmentTarget.allocation_id == FulfillmentAllocation.id)
        .filter(OrderItem.order_id == delivery.order_id)
        .filter(FulfillmentTarget.status == TargetStatus.active)
        .filter(FulfillmentTarget.shipping_channel == ShippingChannel.post_office)
        .filter(FulfillmentAllocation.effective_until_issue.is_(None))
    )
    if delivery.order_item_id:
        q = q.filter(OrderItem.id == delivery.order_item_id)
    return q


def _resolve_current_target(db: Session, delivery: PostalDelivery) -> FulfillmentTarget:
    """精确定位邮局履约目标；没有显式绑定时只接受唯一候选，绝不按 id 猜测。"""
    q = _current_targets_query(db, delivery)
    if delivery.fulfillment_target_id:
        target = q.filter(FulfillmentTarget.id == delivery.fulfillment_target_id).first()
        if target is None:
            raise HTTPException(
                status_code=409,
                detail="投递记录绑定的履约目标已失效或不属于该订单，请先重新关联后再应用",
            )
        return target

    candidates = q.order_by(FulfillmentTarget.id).limit(2).all()
    if not candidates:
        raise HTTPException(
            status_code=409,
            detail="关联订单没有可用的当前邮局履约目标，请先检查订单履约信息",
        )
    if len(candidates) > 1:
        raise HTTPException(
            status_code=409,
            detail="关联订单有多个当前邮局履约目标，无法确定收件人；请先为投递记录绑定履约目标",
        )
    target = candidates[0]
    # 唯一候选只推断一次并固化，下次应用不再重新猜测。
    delivery.order_item_id = target.order_item_id
    delivery.fulfillment_target_id = target.id
    return target


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
        raise HTTPException(status_code=404, detail=f"收件信息变更工单 {change_id} 不存在")
    if ac.applied_to_order:
        raise HTTPException(status_code=409, detail="该收件信息变更已应用，请勿重复")
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

    # 有真实订单时必须先精确确定目标；歧义或失效在写任何地址字段前阻断。
    target = _resolve_current_target(db, rec) if rec.order_id else None

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
    if target is not None:
        if ac.new_name:
            target.recipient_name = ac.new_name
        if ac.new_phone:
            target.recipient_phone = ac.new_phone
        if ac.new_address:
            target.recipient_address = ac.new_address

    _sync_allocations(ac)
    ac.applied_to_order = True
    ac.applied_by = operator_id
    ac.applied_at = datetime.now()
    db.add(PostalComplaintHandlingRecord(
        ticket_id=ac.id,
        event_type=PostalTicketEventType.address_applied,
        handled_at=ac.applied_at,
        handled_by=operator_id,
        action="应用新地址",
        follow_result="已同步履约订单" if target is not None else "仅更新投递明细",
    ))
    db.commit()
    db.refresh(ac)
    return ac


# --- 手工 CRUD：改地址 -----------------------------------------------

def create_address_change(db: Session, payload: dict, operator_id: Optional[int] = None) -> PostalAddressChange:
    """手工新增改地址工单（未应用）。复用编号+年度关联投递记录、routed_label 归一。"""
    d = dict(payload)
    year = d.pop("year", None)
    delivery_no = d.pop("delivery_no", None)
    allocations = d.pop("copy_allocations", None)
    external, pd_id, order_id = pc.link_delivery(db, year, delivery_no)
    handling = d.get("handling")
    rec = PostalAddressChange(
        postal_delivery_id=pd_id,
        order_id=order_id,
        external_order_no=external,
        year=year,
        routed_label=pc.routed_label(handling) if handling else None,
        applied_to_order=False,
        **d,
    )
    _sync_allocations(rec, allocations) if allocations is not None else _sync_allocations(rec)
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec


def update_address_change(db: Session, change_id: int, patch: dict) -> PostalAddressChange:
    rec = (
        db.query(PostalAddressChange)
        .filter(PostalAddressChange.id == change_id)
        .with_for_update()
        .first()
    )
    if rec is None:
        raise HTTPException(status_code=404, detail=f"收件信息变更工单 {change_id} 不存在")
    if rec.applied_to_order:
        raise HTTPException(
            status_code=409,
            detail="该收件信息变更已应用，不能再编辑；如需更正请新建收件信息变更工单",
        )
    patch = dict(patch)
    allocations = patch.pop("copy_allocations", _MISSING)
    relink = "delivery_no" in patch
    year_present = "year" in patch
    year = patch.pop("year", None)
    delivery_no = patch.pop("delivery_no", None)
    if relink:
        external, pd_id, order_id = pc.link_delivery(db, year, delivery_no)
        rec.external_order_no = external
        rec.postal_delivery_id = pd_id
        rec.order_id = order_id
    if year_present:
        rec.year = year
    if "handling" in patch:
        rec.routed_label = pc.routed_label(patch["handling"]) if patch["handling"] else None
    for k, v in patch.items():
        setattr(rec, k, v)
    if allocations is _MISSING:
        _sync_allocations(rec)
    elif allocations is None:
        rec.copy_allocations = None
        _sync_allocations(rec)
    else:
        _sync_allocations(rec, allocations)
    db.commit()
    db.refresh(rec)
    return rec


def resolve_address_allocation(
    db: Session,
    change_id: int,
    payload: dict,
    operator_id: Optional[int] = None,
) -> PostalAddressChange:
    """确认已应用工单中的待定份数；原业务字段保持只读。"""
    rec = (
        db.query(PostalAddressChange)
        .filter(PostalAddressChange.id == change_id)
        .with_for_update()
        .first()
    )
    if rec is None:
        raise HTTPException(status_code=404, detail=f"收件信息变更工单 {change_id} 不存在")
    if not rec.applied_to_order:
        raise HTTPException(status_code=409, detail="请先应用收件信息变更，再确认剩余份数去向")

    rows = address_change_allocations(rec)
    pending = sum(row["copies"] for row in rows if row["kind"] == "pending")
    copies = payload["copies"]
    if pending <= 0:
        raise HTTPException(status_code=409, detail="该工单没有待确认份数")
    if copies > pending:
        raise HTTPException(status_code=400, detail=f"最多只能确认 {pending} 份")
    if payload["kind"] == "changed" and not payload.get("name"):
        raise HTTPException(status_code=400, detail="变更为其他收件人时必须填写姓名")
    if payload["kind"] == "changed" and not payload.get("address"):
        raise HTTPException(status_code=400, detail="变更为其他收件人时必须填写地址")
    if payload["kind"] == "changed" and not payload.get("start_date"):
        raise HTTPException(status_code=400, detail="变更为其他收件人时必须填写起投时间")

    resolved = [row for row in rows if row["kind"] != "pending"]
    resolved.append({**payload, "copies": copies})
    remaining = pending - copies
    if remaining:
        resolved.append({
            "kind": "pending",
            "copies": remaining,
            "name": rec.old_name,
            "phone": rec.old_phone,
            "address": rec.old_address,
            "start_date": _start_date(rec, rec.original_start_month),
        })
    _sync_allocations(rec, resolved)
    db.add(PostalComplaintHandlingRecord(
        ticket_id=rec.id,
        event_type=PostalTicketEventType.address_applied,
        handled_at=datetime.now(),
        handled_by=operator_id,
        action=f"补充确认 {copies} 份去向",
        follow_result="保留原收件人" if payload["kind"] == "retained" else payload["name"],
    ))
    db.commit()
    db.refresh(rec)
    return rec


def delete_address_change(db: Session, change_id: int) -> None:
    rec = (
        db.query(PostalAddressChange)
        .filter(PostalAddressChange.id == change_id)
        .with_for_update()
        .first()
    )
    if rec is None:
        raise HTTPException(status_code=404, detail=f"收件信息变更工单 {change_id} 不存在")
    if rec.applied_to_order:
        raise HTTPException(
            status_code=409,
            detail="该收件信息变更已应用，不能删除；如需更正请新建收件信息变更工单",
        )
    db.delete(rec)
    db.commit()


# --- 手工 CRUD：回访 -------------------------------------------------

def create_follow_up(db: Session, payload: dict, operator_id: Optional[int] = None) -> PostalFollowUp:
    d = dict(payload)
    year = d.pop("year", None)
    delivery_no = d.pop("delivery_no", None)
    external, pd_id, order_id = pc.link_delivery(db, year, delivery_no)
    if pd_id:
        delivery = db.query(PostalDelivery).filter(PostalDelivery.id == pd_id).first()
        if delivery is not None:
            if not d.get("snap_name"):
                d["snap_name"] = delivery.recipient_name
            if not d.get("snap_phone"):
                d["snap_phone"] = delivery.recipient_phone
    rec = PostalFollowUp(
        postal_delivery_id=pd_id,
        order_id=order_id,
        external_order_no=external,
        year=year,
        **d,
    )
    db.add(rec)
    sync_follow_up_timeline(db, rec, operator_id=operator_id)
    db.commit()
    db.refresh(rec)
    return rec


def update_follow_up(db: Session, follow_id: int, patch: dict) -> PostalFollowUp:
    rec = db.query(PostalFollowUp).filter(PostalFollowUp.id == follow_id).first()
    if rec is None:
        raise HTTPException(status_code=404, detail=f"回访记录 {follow_id} 不存在")
    patch = dict(patch)
    relink = "delivery_no" in patch
    year_present = "year" in patch
    year = patch.pop("year", None)
    delivery_no = patch.pop("delivery_no", None)
    if relink:
        external, pd_id, order_id = pc.link_delivery(db, year, delivery_no)
        rec.external_order_no = external
        rec.postal_delivery_id = pd_id
        rec.order_id = order_id
    if year_present:
        rec.year = year
    for k, v in patch.items():
        setattr(rec, k, v)
    sync_follow_up_timeline(db, rec)
    db.commit()
    db.refresh(rec)
    return rec


def delete_follow_up(db: Session, follow_id: int) -> None:
    rec = db.query(PostalFollowUp).filter(PostalFollowUp.id == follow_id).first()
    if rec is None:
        raise HTTPException(status_code=404, detail=f"回访记录 {follow_id} 不存在")
    event = (
        db.query(PostalComplaintHandlingRecord)
        .filter(PostalComplaintHandlingRecord.source_ticket_id == follow_id)
        .first()
    )
    if event is not None:
        db.delete(event)
    db.delete(rec)
    db.commit()
