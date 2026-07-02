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
    AddressChangeListOut,
    AddressChangeOut,
    BatchDetailOut,
    BatchOut,
    BatchRowOut,
    ComplaintListOut,
    ComplaintOut,
    FollowUpListOut,
    GenerateBatchIn,
    PostalCommitIn,
)
from app.services import postal_address_change_import_service as addr_import_svc
from app.services import postal_batch_service as batch_svc
from app.services import postal_change_service as change_svc
from app.services import postal_complaint_import_service as complaint_import_svc
from app.services import postal_complaint_service as complaint_svc
from app.services import postal_follow_up_import_service as follow_import_svc
from app.services import postal_import_service as import_svc

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
    return ComplaintListOut(rows=out, total=total)


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
    return AddressChangeListOut(rows=[AddressChangeOut.model_validate(r) for r in rows], total=total)


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
