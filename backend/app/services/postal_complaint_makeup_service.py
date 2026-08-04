"""Complaint makeup workflow shared by postal tickets, orders and ZTO-MF."""

from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session, selectinload

from app.models import (
    Issue,
    PostalComplaint,
    PostalComplaintHandlingRecord,
    PostalComplaintMakeupItem,
    PostalComplaintMakeupStatus,
    PostalComplaintMakeupTask,
    PostalComplaintStatus,
    PostalDelivery,
    PostalTicketEventType,
    ShippingDetail,
    ShippingDetailSourceType,
    ShippingDetailSyncStatus,
)


def _get_task(db: Session, task_id: int) -> PostalComplaintMakeupTask:
    task = (
        db.query(PostalComplaintMakeupTask)
        .options(
            selectinload(PostalComplaintMakeupTask.items)
            .selectinload(PostalComplaintMakeupItem.shipping_detail)
        )
        .filter(PostalComplaintMakeupTask.id == task_id)
        .first()
    )
    if task is None:
        raise HTTPException(status_code=404, detail=f"补发任务 {task_id} 不存在")
    return task


def _event(
    db: Session,
    task: PostalComplaintMakeupTask,
    event_type: PostalTicketEventType,
    action: str,
    operator_id: Optional[int],
) -> None:
    db.add(PostalComplaintHandlingRecord(
        complaint_id=task.complaint_id,
        event_type=event_type,
        handled_by=operator_id,
        action=action,
        result_status=PostalComplaintStatus.in_progress.value,
    ))


def _task_out(task: PostalComplaintMakeupTask) -> dict:
    return {
        "id": task.id,
        "complaint_id": task.complaint_id,
        "order_id": task.order_id,
        "postal_delivery_id": task.postal_delivery_id,
        "recipient_name": task.recipient_name,
        "recipient_phone": task.recipient_phone,
        "recipient_address": task.recipient_address,
        "status": task.status,
        "tracking_no": task.tracking_no,
        "shipped_at": task.shipped_at,
        "notes": task.notes,
        "created_by": task.created_by,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
        "items": [
            {
                "id": item.id,
                "issue_number": item.issue_number,
                "quantity": item.quantity,
                "shipping_detail_id": item.shipping_detail.id if item.shipping_detail else None,
                "shipped_at": item.shipping_detail.shipped_at if item.shipping_detail else None,
                "shipped_quantity": item.shipping_detail.shipped_quantity if item.shipping_detail else None,
                "tracking_no": item.shipping_detail.tracking_no if item.shipping_detail else None,
            }
            for item in task.items
        ],
    }


def list_makeups(
    db: Session,
    *,
    complaint_id: Optional[int] = None,
    order_id: Optional[int] = None,
) -> list[dict]:
    q = db.query(PostalComplaintMakeupTask).options(
        selectinload(PostalComplaintMakeupTask.items)
        .selectinload(PostalComplaintMakeupItem.shipping_detail)
    )
    if complaint_id is not None:
        q = q.filter(PostalComplaintMakeupTask.complaint_id == complaint_id)
    if order_id is not None:
        q = q.filter(PostalComplaintMakeupTask.order_id == order_id)
    return [_task_out(task) for task in q.order_by(PostalComplaintMakeupTask.id.desc()).all()]


def create_makeup(
    db: Session,
    complaint_id: int,
    payload: dict,
    *,
    operator_id: Optional[int] = None,
) -> dict:
    complaint = db.query(PostalComplaint).filter(PostalComplaint.id == complaint_id).first()
    if complaint is None:
        raise HTTPException(status_code=404, detail=f"投诉工单 {complaint_id} 不存在")

    raw_items = payload.get("items") or []
    issue_numbers = [int(item["issue_number"]) for item in raw_items]
    if len(issue_numbers) != len(set(issue_numbers)):
        raise HTTPException(status_code=400, detail="同一补发任务不能重复选择期次")
    existing_issues = {
        n for (n,) in db.query(Issue.issue_number).filter(Issue.issue_number.in_(issue_numbers)).all()
    }
    missing = sorted(set(issue_numbers) - existing_issues)
    if missing:
        raise HTTPException(status_code=400, detail=f"刊期不存在：{', '.join(map(str, missing))}")

    delivery = None
    if complaint.postal_delivery_id:
        delivery = db.query(PostalDelivery).filter(PostalDelivery.id == complaint.postal_delivery_id).first()
    name = (payload.get("recipient_name") or complaint.snap_name or (delivery.recipient_name if delivery else None) or "").strip()
    phone = payload.get("recipient_phone") or complaint.snap_phone or (delivery.recipient_phone if delivery else None)
    address = (payload.get("recipient_address") or complaint.snap_address or (delivery.recipient_address if delivery else None) or "").strip()
    if not name or not address:
        raise HTTPException(status_code=400, detail="补发前请补全收件人姓名和地址")

    task = PostalComplaintMakeupTask(
        complaint_id=complaint.id,
        order_id=complaint.order_id,
        postal_delivery_id=complaint.postal_delivery_id,
        recipient_name=name,
        recipient_phone=phone,
        recipient_address=address,
        notes=payload.get("notes"),
        created_by=operator_id,
    )
    db.add(task)
    db.flush()

    delivery_no = complaint.external_order_no or "未关联投递编号"
    for raw in raw_items:
        item = PostalComplaintMakeupItem(
            task_id=task.id,
            issue_number=int(raw["issue_number"]),
            quantity=int(raw["quantity"]),
        )
        db.add(item)
        db.flush()
        detail = ShippingDetail(
            issue_number=item.issue_number,
            sheet_name="投诉补发",
            channel="个人订阅",
            sub_channel="投诉补发",
            transport="中通物流",
            frequency="补发",
            status="正常",
            name=name,
            address=address,
            phone=phone,
            quantity=item.quantity,
            notes=payload.get("notes"),
            extra_info=f"邮局投诉工单 #{complaint.id} · 投递编号 {delivery_no}",
            order_id=complaint.order_id,
            source_type=ShippingDetailSourceType.complaint_makeup,
            sync_status=ShippingDetailSyncStatus.synced,
            complaint_makeup_item_id=item.id,
        )
        db.add(detail)

    complaint.status = PostalComplaintStatus.in_progress
    issue_text = "、".join(f"第 {item['issue_number']} 期×{item['quantity']}份" for item in raw_items)
    _event(db, task, PostalTicketEventType.makeup_created, f"创建中通补发任务 #{task.id}：{issue_text}", operator_id)
    db.commit()
    return _task_out(_get_task(db, task.id))


def ship_makeup(
    db: Session,
    task_id: int,
    *,
    tracking_no: str,
    shipped_at: Optional[datetime] = None,
    operator_id: Optional[int] = None,
) -> dict:
    task = _get_task(db, task_id)
    if task.status != PostalComplaintMakeupStatus.ready:
        raise HTTPException(status_code=409, detail="只有待发出的补发任务可以登记发出")
    shipped_time = shipped_at or datetime.now()
    task.status = PostalComplaintMakeupStatus.shipped
    task.tracking_no = tracking_no.strip()
    task.shipped_at = shipped_time
    for item in task.items:
        if item.shipping_detail:
            item.shipping_detail.shipped_at = shipped_time
            item.shipping_detail.shipped_quantity = item.quantity
            item.shipping_detail.tracking_no = task.tracking_no
    _event(db, task, PostalTicketEventType.makeup_shipped, f"中通补发已发出，运单号 {task.tracking_no}", operator_id)
    db.commit()
    return _task_out(_get_task(db, task.id))


def complete_makeup(db: Session, task_id: int, *, operator_id: Optional[int] = None) -> dict:
    task = _get_task(db, task_id)
    if task.status != PostalComplaintMakeupStatus.shipped:
        raise HTTPException(status_code=409, detail="只有已发出的补发任务可以完成")
    task.status = PostalComplaintMakeupStatus.completed
    _event(db, task, PostalTicketEventType.makeup_completed, f"中通补发任务 #{task.id} 已完成", operator_id)
    db.commit()
    return _task_out(_get_task(db, task.id))


def cancel_makeup(db: Session, task_id: int, *, operator_id: Optional[int] = None) -> dict:
    task = _get_task(db, task_id)
    if task.status != PostalComplaintMakeupStatus.ready:
        raise HTTPException(status_code=409, detail="已发出的补发任务不能取消")
    for item in task.items:
        if item.shipping_detail:
            db.delete(item.shipping_detail)
    task.status = PostalComplaintMakeupStatus.cancelled
    _event(db, task, PostalTicketEventType.makeup_cancelled, f"取消中通补发任务 #{task.id}", operator_id)
    db.commit()
    return _task_out(_get_task(db, task.id))


def sync_task_from_shipping_detail(
    db: Session,
    detail: ShippingDetail,
    *,
    operator_id: Optional[int] = None,
) -> None:
    """Keep the work-order task in sync when ZTO-MF marks a makeup row shipped."""
    if detail.source_type != ShippingDetailSourceType.complaint_makeup or not detail.complaint_makeup_item_id:
        return
    item = db.query(PostalComplaintMakeupItem).filter(PostalComplaintMakeupItem.id == detail.complaint_makeup_item_id).first()
    if item is None:
        return
    task = _get_task(db, item.task_id)
    if task.status in (PostalComplaintMakeupStatus.completed, PostalComplaintMakeupStatus.cancelled):
        return
    linked = [i.shipping_detail for i in task.items if i.shipping_detail]
    all_shipped = bool(linked) and all(row.shipped_at is not None for row in linked)
    if all_shipped and task.status == PostalComplaintMakeupStatus.ready:
        task.status = PostalComplaintMakeupStatus.shipped
        task.shipped_at = max(row.shipped_at for row in linked if row.shipped_at)
        task.tracking_no = next((row.tracking_no for row in linked if row.tracking_no), None)
        _event(
            db,
            task,
            PostalTicketEventType.makeup_shipped,
            f"ZTO-MF 已登记补发发出{f'，运单号 {task.tracking_no}' if task.tracking_no else ''}",
            operator_id,
        )
    elif not all_shipped and task.status == PostalComplaintMakeupStatus.shipped:
        task.status = PostalComplaintMakeupStatus.ready
        task.shipped_at = None
        task.tracking_no = None
