"""邮局投递 REST API（导入 + 每月起投批次）。

挂 ``/api/postal``（auth 在 main.py include 时统一注入）。读对所有登录用户开放；
写（导入提交 / 生成批次 / 标记已发）要求 ``require_admin``。
"""

import io
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import Partner, PostalComplaintStatus, PostalDeliveryRow, User
from app.schemas.postal import (
    AddressChangeCreateIn,
    AddressChangeListOut,
    AddressChangeOut,
    AddressChangeUpdateIn,
    BatchDetailOut,
    BatchOut,
    BatchRowOut,
    ComplaintCreateIn,
    ComplaintDetailOut,
    ComplaintListOut,
    ComplaintOut,
    ComplaintUpdateIn,
    DeliveryCreateIn,
    DeliveryListOut,
    DeliveryOut,
    DeliveryUpdateIn,
    FollowUpCreateIn,
    FollowUpListOut,
    FollowUpOut,
    FollowUpUpdateIn,
    GenerateBatchIn,
    HandlingCreateIn,
    HandlingRecordOut,
    PostalCommitIn,
)
from app.services import postal_address_change_import_service as addr_import_svc
from app.services import postal_batch_service as batch_svc
from app.services import postal_change_service as change_svc
from app.services import postal_complaint_import_service as complaint_import_svc
from app.services import postal_complaint_service as complaint_svc
from app.services import postal_delivery_import_service as import_svc
from app.services import postal_delivery_service as delivery_svc
from app.services import postal_follow_up_import_service as follow_import_svc

router = APIRouter(prefix="/api/postal", tags=["postal"])


def _unit_names(db: Session, rows: List[PostalDeliveryRow]) -> dict:
    ids = {r.distribution_unit_id for r in rows if r.distribution_unit_id}
    if not ids:
        return {}
    return {
        pid: name
        for pid, name in db.query(Partner.id, Partner.name)
        .filter(Partner.id.in_(ids))
        .all()
    }


def _row_out(row: PostalDeliveryRow, names: dict) -> BatchRowOut:
    out = BatchRowOut.model_validate(row)
    out.distribution_unit_name = names.get(row.distribution_unit_id)
    return out


def _partner_name(db: Session, partner_id) -> Optional[str]:
    if not partner_id:
        return None
    return db.query(Partner.name).filter(Partner.id == partner_id).scalar()


def _delivery_out(db: Session, rec) -> DeliveryOut:
    out = DeliveryOut.model_validate(rec)
    out.distribution_unit_name = _partner_name(db, rec.distribution_unit_id)
    return out


def _complaint_out(db: Session, rec) -> ComplaintOut:
    out = ComplaintOut.model_validate(rec)
    out.routed_unit_name = _partner_name(db, rec.routed_unit_id)
    return out


def _handling_out(db: Session, handlings) -> List[HandlingRecordOut]:
    uids = {h.handled_by for h in handlings if h.handled_by}
    names = (
        {uid: n for uid, n in db.query(User.id, User.username).filter(User.id.in_(uids)).all()}
        if uids else {}
    )
    out = []
    for h in handlings:
        o = HandlingRecordOut.model_validate(h)
        o.handled_by_name = names.get(h.handled_by)
        out.append(o)
    return out


def _complaint_detail(db: Session, complaint_id: int) -> ComplaintDetailOut:
    rec, handlings = complaint_svc.get_complaint_detail(db, complaint_id)
    return ComplaintDetailOut(
        complaint=_complaint_out(db, rec),
        handlings=_handling_out(db, handlings),
    )


# --- 导入 -------------------------------------------------------------------

@router.post("/import/preview")
async def import_preview(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="上传文件为空")
    out, _ = import_svc.preview_import(db, content)
    return out


@router.post("/import/commit")
def import_commit(
    body: PostalCommitIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    return import_svc.commit_import(db, body.session_id, operator_id=getattr(user, "id", None))


# --- 投递名册（全部投递记录） -------------------------------------------------

@router.get("/deliveries", response_model=DeliveryListOut)
def list_deliveries(
    year: Optional[int] = None,
    channel: Optional[str] = None,
    distribution_unit_id: Optional[int] = None,
    month: Optional[int] = None,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    rows, total = delivery_svc.list_deliveries(
        db, year=year, channel=channel, distribution_unit_id=distribution_unit_id,
        month=month, search=search, page=page, page_size=page_size,
    )
    ids = {r.distribution_unit_id for r in rows if r.distribution_unit_id}
    names = (
        {pid: n for pid, n in db.query(Partner.id, Partner.name).filter(Partner.id.in_(ids)).all()}
        if ids else {}
    )
    out = []
    for r in rows:
        o = DeliveryOut.model_validate(r)
        o.distribution_unit_name = names.get(r.distribution_unit_id)
        out.append(o)
    summary = delivery_svc.summarize_deliveries(
        db, year=year, channel=channel, distribution_unit_id=distribution_unit_id,
        month=month, search=search,
    )
    return DeliveryListOut(rows=out, total=total, summary=summary)


@router.post("/deliveries", response_model=DeliveryOut, status_code=201)
def create_delivery(
    body: DeliveryCreateIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    rec = delivery_svc.create_delivery(db, body.model_dump(), operator_id=getattr(user, "id", None))
    return _delivery_out(db, rec)


@router.put("/deliveries/{delivery_id}", response_model=DeliveryOut)
def update_delivery(
    delivery_id: int,
    body: DeliveryUpdateIn,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    rec = delivery_svc.update_delivery(db, delivery_id, body.model_dump(exclude_unset=True))
    return _delivery_out(db, rec)


@router.delete("/deliveries/{delivery_id}", status_code=204)
def delete_delivery(
    delivery_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    delivery_svc.delete_delivery(db, delivery_id)


# --- 批次 -------------------------------------------------------------------

@router.get("/batches", response_model=List[BatchOut])
def list_batches(db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    return batch_svc.list_batches(db)


@router.post("/batches/generate", response_model=BatchOut)
def generate_batch(
    body: GenerateBatchIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    return batch_svc.generate_batch(
        db, body.year, body.month, operator_id=getattr(user, "id", None)
    )


@router.get("/batches/{batch_id}", response_model=BatchDetailOut)
def get_batch(batch_id: int, db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    batch = batch_svc.get_batch(db, batch_id)
    rows = batch_svc.get_batch_rows(db, batch_id)
    names = _unit_names(db, rows)
    return BatchDetailOut(
        batch=BatchOut.model_validate(batch),
        rows=[_row_out(r, names) for r in rows],
    )


@router.post("/batches/{batch_id}/mark-sent", response_model=BatchOut)
def mark_sent(batch_id: int, db: Session = Depends(get_db), _user: User = Depends(require_admin)):
    return batch_svc.mark_sent(db, batch_id)


@router.get("/batches/{batch_id}/export")
def export_batch(batch_id: int, db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    import openpyxl

    batch = batch_svc.get_batch(db, batch_id)
    rows = batch_svc.get_batch_rows(db, batch_id)
    names = _unit_names(db, rows)

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = f"{batch.year}-{batch.month:02d}"
    ws.append([
        "收报人", "联系电话", "省", "市", "区", "详细地址", "邮编",
        "份数", "起月", "止月", "投递单位", "渠道", "业务员",
    ])
    for r in rows:
        ws.append([
            r.snap_name, r.snap_phone, r.snap_province, r.snap_city, r.snap_district,
            r.snap_address, r.snap_postal_code, r.copies,
            r.coverage_start_date.isoformat() if r.coverage_start_date else "",
            r.coverage_end_date.isoformat() if r.coverage_end_date else "",
            names.get(r.distribution_unit_id) or "", r.source_channel or "", r.salesperson or "",
        ])
    bio = io.BytesIO()
    wb.save(bio)
    bio.seek(0)
    filename = f"postal-delivery-{batch.year}-{batch.month:02d}.xlsx"
    return StreamingResponse(
        bio,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# --- 投诉工单 (P2) -----------------------------------------------------------

@router.get("/complaints", response_model=ComplaintListOut)
def list_complaints(
    year: Optional[int] = None,
    status: Optional[PostalComplaintStatus] = None,
    distribution_unit_id: Optional[int] = None,
    min_handling_count: Optional[int] = None,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    rows, total = complaint_svc.list_complaints(
        db, year=year, status=status.value if status else None,
        distribution_unit_id=distribution_unit_id,
        min_handling_count=min_handling_count, search=search, page=page, page_size=page_size,
    )
    ids = {r.routed_unit_id for r in rows if r.routed_unit_id}
    names = (
        {pid: n for pid, n in db.query(Partner.id, Partner.name).filter(Partner.id.in_(ids)).all()}
        if ids else {}
    )
    out = []
    for r in rows:
        o = ComplaintOut.model_validate(r)
        o.routed_unit_name = names.get(r.routed_unit_id)
        out.append(o)
    summary = complaint_svc.summarize_complaints(
        db, year=year, distribution_unit_id=distribution_unit_id,
        min_handling_count=min_handling_count, search=search,
    )
    return ComplaintListOut(rows=out, total=total, summary=summary)


@router.post("/complaints/import/preview")
async def complaint_import_preview(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="上传文件为空")
    out, _ = complaint_import_svc.preview_import(db, content)
    return out


@router.post("/complaints/import/commit")
def complaint_import_commit(
    body: PostalCommitIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    return complaint_import_svc.commit_import(db, body.session_id, operator_id=getattr(user, "id", None))


@router.post("/complaints", response_model=ComplaintOut, status_code=201)
def create_complaint(
    body: ComplaintCreateIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    rec = complaint_svc.create_complaint(db, body.model_dump(), operator_id=getattr(user, "id", None))
    return _complaint_out(db, rec)


@router.get("/complaints/{complaint_id}", response_model=ComplaintDetailOut)
def get_complaint_detail(
    complaint_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    return _complaint_detail(db, complaint_id)


@router.put("/complaints/{complaint_id}", response_model=ComplaintOut)
def update_complaint(
    complaint_id: int,
    body: ComplaintUpdateIn,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    rec = complaint_svc.update_complaint(db, complaint_id, body.model_dump(exclude_unset=True))
    return _complaint_out(db, rec)


@router.delete("/complaints/{complaint_id}", status_code=204)
def delete_complaint(
    complaint_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    complaint_svc.delete_complaint(db, complaint_id)


@router.post("/complaints/{complaint_id}/handlings", response_model=ComplaintDetailOut, status_code=201)
def add_complaint_handling(
    complaint_id: int,
    body: HandlingCreateIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    complaint_svc.add_handling(
        db, complaint_id,
        action=body.action,
        follow_result=body.follow_result,
        result_status=body.result_status,
        operator_id=getattr(user, "id", None),
    )
    return _complaint_detail(db, complaint_id)


@router.delete("/complaints/{complaint_id}/handlings/{handling_id}", response_model=ComplaintDetailOut)
def delete_complaint_handling(
    complaint_id: int,
    handling_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    complaint_svc.delete_handling(db, complaint_id, handling_id)
    return _complaint_detail(db, complaint_id)


# --- 改地址工单 (P3) ---------------------------------------------------------

@router.get("/address-changes", response_model=AddressChangeListOut)
def list_address_changes(
    year: Optional[int] = None,
    applied: Optional[bool] = None,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    rows, total = change_svc.list_address_changes(
        db, year=year, applied=applied, search=search, page=page, page_size=page_size,
    )
    summary = change_svc.summarize_address_changes(db, year=year, search=search)
    return AddressChangeListOut(rows=[AddressChangeOut.model_validate(r) for r in rows], total=total, summary=summary)


@router.post("/address-changes/{change_id}/apply", response_model=AddressChangeOut)
def apply_address_change(change_id: int, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    return change_svc.apply_address_change(db, change_id, operator_id=getattr(user, "id", None))


@router.post("/address-changes/import/preview")
async def address_change_import_preview(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="上传文件为空")
    out, _ = addr_import_svc.preview_import(db, content)
    return out


@router.post("/address-changes/import/commit")
def address_change_import_commit(body: PostalCommitIn, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    return addr_import_svc.commit_import(db, body.session_id, operator_id=getattr(user, "id", None))


@router.post("/address-changes", response_model=AddressChangeOut, status_code=201)
def create_address_change(
    body: AddressChangeCreateIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    rec = change_svc.create_address_change(db, body.model_dump(), operator_id=getattr(user, "id", None))
    return AddressChangeOut.model_validate(rec)


@router.put("/address-changes/{change_id}", response_model=AddressChangeOut)
def update_address_change(
    change_id: int,
    body: AddressChangeUpdateIn,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    rec = change_svc.update_address_change(db, change_id, body.model_dump(exclude_unset=True))
    return AddressChangeOut.model_validate(rec)


@router.delete("/address-changes/{change_id}", status_code=204)
def delete_address_change(
    change_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    change_svc.delete_address_change(db, change_id)


# --- 回访 (P3) ---------------------------------------------------------------

@router.get("/follow-ups", response_model=FollowUpListOut)
def list_follow_ups(
    year: Optional[int] = None,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    rows, total = change_svc.list_follow_ups(db, year=year, search=search, page=page, page_size=page_size)
    return FollowUpListOut(rows=rows, total=total)


@router.post("/follow-ups/import/preview")
async def follow_up_import_preview(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="上传文件为空")
    out, _ = follow_import_svc.preview_import(db, content)
    return out


@router.post("/follow-ups/import/commit")
def follow_up_import_commit(body: PostalCommitIn, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    return follow_import_svc.commit_import(db, body.session_id, operator_id=getattr(user, "id", None))


@router.post("/follow-ups", response_model=FollowUpOut, status_code=201)
def create_follow_up(
    body: FollowUpCreateIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    rec = change_svc.create_follow_up(db, body.model_dump(), operator_id=getattr(user, "id", None))
    return FollowUpOut.model_validate(rec)


@router.put("/follow-ups/{follow_id}", response_model=FollowUpOut)
def update_follow_up(
    follow_id: int,
    body: FollowUpUpdateIn,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    rec = change_svc.update_follow_up(db, follow_id, body.model_dump(exclude_unset=True))
    return FollowUpOut.model_validate(rec)


@router.delete("/follow-ups/{follow_id}", status_code=204)
def delete_follow_up(
    follow_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    change_svc.delete_follow_up(db, follow_id)
