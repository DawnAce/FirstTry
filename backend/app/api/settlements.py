"""渠道结算 REST API（财务 · 与合作渠道对账打款 + 进项发票归档）。

挂在 ``/api/settlements``（auth 在 main.py include 时统一注入）。读 / 下载对所有登录用户开放；
增 / 改 / 删 / 传 / 删附件要求 ``require_admin``。复用模块二的 ``partners`` / ``contracts`` 与
``attachment_service``（结算单 / 进项发票扫描件落 backend/uploads/settlements/，鉴权下载）。
"""

from contextlib import suppress
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import ChannelSettlement, Contract, Partner, SettlementStatus, User
from app.schemas.finance import SettlementCreate, SettlementOut, SettlementUpdate
from app.services import attachment_service
from app.upload import read_upload

router = APIRouter(prefix="/api/settlements", tags=["settlements"])

ATTACHMENT_CATEGORY = "settlements"
ALLOWED_SUFFIXES = {".pdf", ".jpg", ".jpeg", ".png"}


def _to_out(s: ChannelSettlement) -> SettlementOut:
    return SettlementOut(
        id=s.id,
        partner_id=s.partner_id,
        partner_name=s.partner.name if s.partner else "",
        contract_id=s.contract_id,
        period=s.period,
        amount_due=s.amount_due,
        paid_amount=s.paid_amount,
        paid_date=s.paid_date,
        on_time=s.on_time,
        invoice_received=s.invoice_received,
        invoice_no=s.invoice_no,
        status=s.status,
        notes=s.notes,
        attachment_filename=s.attachment_filename,
        has_attachment=bool(s.attachment_path),
        created_at=s.created_at,
        updated_at=s.updated_at,
    )


def _get_or_404(db: Session, settlement_id: int) -> ChannelSettlement:
    s = db.query(ChannelSettlement).filter(ChannelSettlement.id == settlement_id).first()
    if s is None:
        raise HTTPException(status_code=404, detail=f"结算记录 {settlement_id} 不存在")
    return s


def _validate_refs(db: Session, partner_id: int, contract_id: Optional[int]) -> None:
    if db.query(Partner).filter(Partner.id == partner_id).first() is None:
        raise HTTPException(status_code=400, detail=f"合作渠道 {partner_id} 不存在")
    if contract_id is not None:
        if db.query(Contract).filter(Contract.id == contract_id).first() is None:
            raise HTTPException(status_code=400, detail=f"合同 {contract_id} 不存在")


@router.get("", response_model=List[SettlementOut])
def list_settlements(
    partner_id: Optional[int] = None,
    status: Optional[SettlementStatus] = None,
    q: Optional[str] = Query(default=None, description="模糊匹配 结算周期 / 进项发票号"),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    query = db.query(ChannelSettlement)
    if partner_id is not None:
        query = query.filter(ChannelSettlement.partner_id == partner_id)
    if status is not None:
        query = query.filter(ChannelSettlement.status == status)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            ChannelSettlement.period.ilike(like)
            | ChannelSettlement.invoice_no.ilike(like)
        )
    rows = query.order_by(
        ChannelSettlement.period.desc(),
        ChannelSettlement.id.desc(),
    ).all()
    return [_to_out(s) for s in rows]


@router.post("", response_model=SettlementOut, status_code=201)
def create_settlement(
    data: SettlementCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    _validate_refs(db, data.partner_id, data.contract_id)
    s = ChannelSettlement(**data.model_dump(), created_by=admin.id)
    db.add(s)
    db.commit()
    db.refresh(s)
    return _to_out(s)


@router.put("/{settlement_id}", response_model=SettlementOut)
def update_settlement(
    settlement_id: int,
    data: SettlementUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    s = _get_or_404(db, settlement_id)
    patch = data.model_dump(exclude_unset=True)
    new_partner = patch.get("partner_id", s.partner_id)
    new_contract = patch.get("contract_id", s.contract_id)
    if "partner_id" in patch or "contract_id" in patch:
        _validate_refs(db, new_partner, new_contract)
    for field, value in patch.items():
        setattr(s, field, value)
    db.commit()
    db.refresh(s)
    return _to_out(s)


@router.delete("/{settlement_id}", status_code=204)
def delete_settlement(
    settlement_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    s = _get_or_404(db, settlement_id)
    stored_path = s.attachment_path
    db.delete(s)
    db.commit()
    attachment_service.delete_file(stored_path)


# --------------------------------------------------------------------------- #
# 结算单 / 进项发票附件
# --------------------------------------------------------------------------- #
@router.post("/{settlement_id}/attachment", response_model=SettlementOut)
async def upload_attachment(
    settlement_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    s = _get_or_404(db, settlement_id)
    filename = (file.filename or "").strip() or "settlement"
    suffix = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(status_code=400, detail="仅支持 PDF / JPG / PNG")

    content = await read_upload(file, label="附件")

    old_path = s.attachment_path
    stored_path = attachment_service.store_file(ATTACHMENT_CATEGORY, filename, content)
    s.attachment_path = stored_path
    s.attachment_filename = filename
    try:
        db.commit()
    except Exception:
        with suppress(Exception):
            db.rollback()
        attachment_service.delete_file(stored_path)
        raise
    db.refresh(s)
    if old_path and old_path != stored_path:
        attachment_service.delete_file(old_path)
    return _to_out(s)


@router.get("/{settlement_id}/attachment")
def download_attachment(
    settlement_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    s = _get_or_404(db, settlement_id)
    if not s.attachment_path:
        raise HTTPException(status_code=404, detail="该结算记录没有附件")
    try:
        path = attachment_service.resolve_path(s.attachment_path)
    except ValueError:
        raise HTTPException(status_code=404, detail="附件路径无效")
    if not path.exists():
        raise HTTPException(status_code=404, detail="附件文件丢失")
    return FileResponse(path, filename=s.attachment_filename or path.name)


@router.delete("/{settlement_id}/attachment", response_model=SettlementOut)
def delete_attachment(
    settlement_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    s = _get_or_404(db, settlement_id)
    old_path = s.attachment_path
    s.attachment_path = None
    s.attachment_filename = None
    db.commit()
    db.refresh(s)
    attachment_service.delete_file(old_path)
    return _to_out(s)
