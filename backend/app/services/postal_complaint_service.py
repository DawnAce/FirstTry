"""邮局投诉工单 · 列表（筛选 + 分页）+ 手工 CRUD + 三态处理流程。"""

from typing import List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models import (
    PostalComplaint,
    PostalComplaintHandlingRecord,
    PostalComplaintStatus,
    PostalDelivery,
)
from app.services import postal_common as pc


def _complaints_query(
    db: Session,
    *,
    year: Optional[int] = None,
    status: Optional[str] = None,
    distribution_unit_id: Optional[int] = None,
    min_handling_count: Optional[int] = None,
    search: Optional[str] = None,
):
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
    return q


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
    q = _complaints_query(
        db, year=year, status=status, distribution_unit_id=distribution_unit_id,
        min_handling_count=min_handling_count, search=search,
    )
    total = q.count()
    rows = (
        q.order_by(PostalComplaint.complaint_date.desc(), PostalComplaint.id.desc())
        .offset(max(0, (page - 1) * page_size))
        .limit(page_size)
        .all()
    )
    return rows, total


def summarize_complaints(
    db: Session,
    *,
    year: Optional[int] = None,
    distribution_unit_id: Optional[int] = None,
    min_handling_count: Optional[int] = None,
    search: Optional[str] = None,
) -> dict:
    """概览行：按状态计数（忽略状态筛选，用作快筛计数）。"""
    q = _complaints_query(
        db, year=year, status=None, distribution_unit_id=distribution_unit_id,
        min_handling_count=min_handling_count, search=search,
    )
    rows = (
        q.with_entities(PostalComplaint.status, func.count(PostalComplaint.id))
        .group_by(PostalComplaint.status)
        .all()
    )
    counts = {s.value: 0 for s in PostalComplaintStatus}
    for status_val, cnt in rows:
        key = status_val.value if hasattr(status_val, "value") else str(status_val)
        counts[key] = int(cnt)
    return {
        "open": counts.get("open", 0),
        "in_progress": counts.get("in_progress", 0),
        "resolved": counts.get("resolved", 0),
    }


# --- 手工 CRUD --------------------------------------------------------

def _backfill_snapshot(db: Session, d: dict, postal_delivery_id: Optional[int]) -> None:
    """命中投递记录且用户未填快照时，用投递记录的收报人回填快照字段。"""
    if not postal_delivery_id:
        return
    dv = db.query(PostalDelivery).filter(PostalDelivery.id == postal_delivery_id).first()
    if dv is None:
        return
    if not d.get("snap_name"):
        d["snap_name"] = dv.recipient_name
    if not d.get("snap_phone"):
        d["snap_phone"] = dv.recipient_phone
    if not d.get("snap_address"):
        d["snap_address"] = dv.recipient_address
    if not d.get("snap_postal_code"):
        d["snap_postal_code"] = dv.recipient_postal_code


def create_complaint(db: Session, payload: dict, operator_id: Optional[int] = None) -> PostalComplaint:
    """手工新增投诉。复用导入派生：编号+年度关联投递记录、继承 order_id、routed_label 归一。"""
    d = dict(payload)
    year = d.pop("year", None)
    delivery_no = d.pop("delivery_no", None)
    status = d.pop("status", None) or PostalComplaintStatus.open
    if not isinstance(status, PostalComplaintStatus):
        status = PostalComplaintStatus(status)
    external, pd_id, order_id = pc.link_delivery(db, year, delivery_no)
    handling = d.get("handling")
    _backfill_snapshot(db, d, pd_id)
    rec = PostalComplaint(
        postal_delivery_id=pd_id,
        order_id=order_id,
        external_order_no=external,
        year=year,
        routed_label=pc.routed_label(handling) if handling else None,
        status=status,
        **d,
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec


def update_complaint(db: Session, complaint_id: int, patch: dict) -> PostalComplaint:
    rec = db.query(PostalComplaint).filter(PostalComplaint.id == complaint_id).first()
    if rec is None:
        raise HTTPException(status_code=404, detail=f"投诉工单 {complaint_id} 不存在")
    patch = dict(patch)
    if "delivery_no" in patch:
        delivery_no = patch.pop("delivery_no")
        year = patch.get("year", rec.year)
        external, pd_id, order_id = pc.link_delivery(db, year, delivery_no)
        rec.external_order_no = external
        rec.postal_delivery_id = pd_id
        rec.order_id = order_id
    if "handling" in patch:
        rec.routed_label = pc.routed_label(patch["handling"]) if patch["handling"] else None
    if "status" in patch:
        if patch["status"] is None:
            patch.pop("status")  # 显式 null 视为「不修改」（status 非空列，避免 500）
        elif not isinstance(patch["status"], PostalComplaintStatus):
            patch["status"] = PostalComplaintStatus(patch["status"])
    for k, v in patch.items():
        setattr(rec, k, v)
    db.commit()
    db.refresh(rec)
    return rec


def delete_complaint(db: Session, complaint_id: int) -> None:
    rec = db.query(PostalComplaint).filter(PostalComplaint.id == complaint_id).first()
    if rec is None:
        raise HTTPException(status_code=404, detail=f"投诉工单 {complaint_id} 不存在")
    db.delete(rec)  # 处理记录经 relationship / FK CASCADE 一并删除
    db.commit()


# --- 三态处理流程 -----------------------------------------------------

def get_complaint_detail(
    db: Session, complaint_id: int
) -> Tuple[PostalComplaint, List[PostalComplaintHandlingRecord]]:
    rec = db.query(PostalComplaint).filter(PostalComplaint.id == complaint_id).first()
    if rec is None:
        raise HTTPException(status_code=404, detail=f"投诉工单 {complaint_id} 不存在")
    handlings = (
        db.query(PostalComplaintHandlingRecord)
        .filter(PostalComplaintHandlingRecord.complaint_id == complaint_id)
        .order_by(
            PostalComplaintHandlingRecord.handled_at.desc(),
            PostalComplaintHandlingRecord.id.desc(),
        )
        .all()
    )
    return rec, handlings


def add_handling(
    db: Session,
    complaint_id: int,
    *,
    action: str,
    follow_result: Optional[str] = None,
    result_status=None,
    operator_id: Optional[int] = None,
) -> PostalComplaint:
    """登记一次处理：追加时间线一行 → 处理次数 +1 → 状态置为本次处理后状态（缺省 处理中）。"""
    rec = (
        db.query(PostalComplaint)
        .filter(PostalComplaint.id == complaint_id)
        .with_for_update()
        .first()
    )
    if rec is None:
        raise HTTPException(status_code=404, detail=f"投诉工单 {complaint_id} 不存在")
    rs = result_status
    if rs is not None and not isinstance(rs, PostalComplaintStatus):
        rs = PostalComplaintStatus(rs)
    if rs is None:
        rs = PostalComplaintStatus.in_progress  # 未指定 → 置为处理中
    db.add(
        PostalComplaintHandlingRecord(
            complaint_id=rec.id,
            handled_by=operator_id,
            action=action,
            follow_result=follow_result,
            result_status=rs.value,  # 始终记录本次处理后状态，供删记录时回退
        )
    )
    rec.handling_count = (rec.handling_count or 0) + 1
    rec.status = rs
    if follow_result:
        rec.follow_up = follow_result
    db.commit()
    db.refresh(rec)
    return rec


def delete_handling(db: Session, complaint_id: int, handling_id: int) -> PostalComplaint:
    """删除一条处理记录（纠错）：处理次数 -1，状态回退到剩余最新处理（无则回 待处理）。"""
    rec = (
        db.query(PostalComplaint)
        .filter(PostalComplaint.id == complaint_id)
        .with_for_update()
        .first()
    )
    if rec is None:
        raise HTTPException(status_code=404, detail=f"投诉工单 {complaint_id} 不存在")
    h = (
        db.query(PostalComplaintHandlingRecord)
        .filter(
            PostalComplaintHandlingRecord.id == handling_id,
            PostalComplaintHandlingRecord.complaint_id == complaint_id,
        )
        .first()
    )
    if h is None:
        raise HTTPException(status_code=404, detail=f"处理记录 {handling_id} 不存在")
    db.delete(h)
    rec.handling_count = max(0, (rec.handling_count or 0) - 1)
    db.flush()
    latest = (
        db.query(PostalComplaintHandlingRecord)
        .filter(PostalComplaintHandlingRecord.complaint_id == complaint_id)
        .order_by(
            PostalComplaintHandlingRecord.handled_at.desc(),
            PostalComplaintHandlingRecord.id.desc(),
        )
        .first()
    )
    if latest is not None and latest.result_status:
        rec.status = PostalComplaintStatus(latest.result_status)
    elif (rec.handling_count or 0) == 0:
        # 无剩余处理记录且无导入基线次数 → 回到待处理；
        # 若仍有导入基线（handling_count>0、本就无子表行）则保留原状态，不误置 open。
        rec.status = PostalComplaintStatus.open
    db.commit()
    db.refresh(rec)
    return rec
