"""邮局投递 REST API（导入 + 投递名册 + 工单）。

挂 ``/api/postal``（auth 在 main.py include 时统一注入）。读对所有登录用户开放；
写（导入提交 / 新增 / 编辑 / 删除）要求 ``require_admin``。
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import Partner, PostalComplaintStatus, User
from app.schemas.postal import (
    AddressChangeCreateIn,
    AddressChangeListOut,
    AddressChangeOut,
    AddressChangeUpdateIn,
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
    HandlingCreateIn,
    HandlingRecordOut,
    PostalCommitIn,
)
from app.services import postal_address_change_import_service as addr_import_svc
from app.services import postal_change_service as change_svc
from app.services import postal_complaint_import_service as complaint_import_svc
from app.services import postal_complaint_service as complaint_svc
from app.services import postal_delivery_import_service as import_svc
from app.services import postal_delivery_service as delivery_svc
from app.services import postal_follow_up_import_service as follow_import_svc

router = APIRouter(prefix="/api/postal", tags=["postal"])


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
