"""渠道结算 REST API（财务 · 应收/应付对账、结款、开票与凭证归档）。

挂在 ``/api/settlements``（auth 在 main.py include 时统一注入）。读 / 下载对所有登录用户开放；
增 / 改 / 删 / 传 / 删附件要求 ``require_admin``。复用模块二的 ``partners`` / ``contracts`` 与
``attachment_service``（结算单 / 进项发票扫描件落 backend/uploads/settlements/，鉴权下载）。
"""

from contextlib import suppress
from datetime import date
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import (
    ChannelSettlement,
    Contract,
    Partner,
    SettlementAttachment,
    SettlementAttachmentCategory,
    SettlementDirection,
    SettlementStatus,
    User,
)
from app.schemas.finance import (
    SettlementAttachmentOut,
    SettlementCreate,
    SettlementOut,
    SettlementUpdate,
)
from app.services import attachment_service
from app.upload import read_upload

router = APIRouter(prefix="/api/settlements", tags=["settlements"])

ATTACHMENT_CATEGORY = "settlements"
ALLOWED_SUFFIXES = {".pdf", ".jpg", ".jpeg", ".png", ".xls", ".xlsx"}
NORMALIZED_TEXT_FIELDS = {
    "settlement_no",
    "period",
    "invoice_no",
    "invoice_title",
    "invoice_tax_no",
    "invoice_item_name",
    "invoice_unit",
}


def _normalize_strings(payload: dict) -> dict:
    for field in NORMALIZED_TEXT_FIELDS:
        value = payload.get(field)
        if isinstance(value, str):
            payload[field] = value.strip() or None
    return payload


def _attachment_out(attachment: SettlementAttachment) -> SettlementAttachmentOut:
    return SettlementAttachmentOut(
        id=attachment.id,
        category=attachment.category,
        filename=attachment.filename,
        content_type=attachment.content_type,
        created_at=attachment.created_at,
    )


def _to_out(s: ChannelSettlement) -> SettlementOut:
    attachments = [_attachment_out(item) for item in s.attachments]
    return SettlementOut(
        id=s.id,
        partner_id=s.partner_id,
        partner_name=s.partner.name if s.partner else "",
        contract_id=s.contract_id,
        direction=s.direction,
        settlement_no=s.settlement_no,
        period=s.period,
        settlement_start_date=s.settlement_start_date,
        settlement_end_date=s.settlement_end_date,
        return_start_date=s.return_start_date,
        return_end_date=s.return_end_date,
        gross_amount=s.gross_amount,
        return_deduction_amount=s.return_deduction_amount,
        amount_due=s.amount_due,
        paid_amount=s.paid_amount,
        paid_date=s.paid_date,
        on_time=s.on_time,
        invoice_received=s.invoice_received,
        invoice_no=s.invoice_no,
        invoice_title=s.invoice_title,
        invoice_tax_no=s.invoice_tax_no,
        invoice_taxpayer_type=s.invoice_taxpayer_type,
        invoice_type=s.invoice_type,
        invoice_item_name=s.invoice_item_name,
        invoice_unit=s.invoice_unit,
        invoice_quantity=s.invoice_quantity,
        invoice_unit_price=s.invoice_unit_price,
        invoice_tax_rate=s.invoice_tax_rate,
        invoice_amount=s.invoice_amount,
        status=s.status,
        notes=s.notes,
        attachment_filename=(
            attachments[-1].filename if attachments else s.attachment_filename
        ),
        has_attachment=bool(attachments or s.attachment_path),
        attachments=attachments,
        created_at=s.created_at,
        updated_at=s.updated_at,
    )


def _get_or_404(db: Session, settlement_id: int) -> ChannelSettlement:
    s = db.query(ChannelSettlement).filter(ChannelSettlement.id == settlement_id).first()
    if s is None:
        raise HTTPException(status_code=404, detail=f"结算记录 {settlement_id} 不存在")
    return s


def _validate_refs(db: Session, partner_id: int, contract_id: Optional[int]) -> Partner:
    partner = db.query(Partner).filter(Partner.id == partner_id).first()
    if partner is None:
        raise HTTPException(status_code=400, detail=f"合作渠道 {partner_id} 不存在")
    if contract_id is not None:
        contract = db.query(Contract).filter(Contract.id == contract_id).first()
        if contract is None:
            raise HTTPException(status_code=400, detail=f"合同 {contract_id} 不存在")
        if contract.partner_id != partner_id:
            raise HTTPException(status_code=400, detail="所选合同不属于当前合作渠道")
    return partner


def _validate_unique_no(
    db: Session,
    settlement_no: Optional[str],
    *,
    exclude_id: Optional[int] = None,
) -> None:
    if not settlement_no:
        return
    query = db.query(ChannelSettlement).filter(
        ChannelSettlement.settlement_no == settlement_no
    )
    if exclude_id is not None:
        query = query.filter(ChannelSettlement.id != exclude_id)
    if query.first() is not None:
        raise HTTPException(status_code=409, detail=f"结算单号 {settlement_no} 已存在")


def _validate_business(payload: dict, *, allow_legacy_period: bool = True) -> dict:
    start = payload.get("settlement_start_date")
    end = payload.get("settlement_end_date")
    if bool(start) != bool(end):
        raise HTTPException(status_code=400, detail="结算周期必须同时填写开始和结束日期")
    if start and end and start > end:
        raise HTTPException(status_code=400, detail="结算周期开始日期不能晚于结束日期")
    if not start and not end and not (allow_legacy_period and payload.get("period")):
        raise HTTPException(status_code=400, detail="请选择结算周期")

    return_start = payload.get("return_start_date")
    return_end = payload.get("return_end_date")
    if bool(return_start) != bool(return_end):
        raise HTTPException(status_code=400, detail="退报周期必须同时填写开始和结束日期")
    if return_start and return_end and return_start > return_end:
        raise HTTPException(status_code=400, detail="退报周期开始日期不能晚于结束日期")

    deduction = payload.get("return_deduction_amount") or Decimal("0")
    gross = payload.get("gross_amount")
    if deduction > 0 and gross is None:
        raise HTTPException(status_code=400, detail="填写退报扣款时必须填写报款/结算总额")
    if deduction > 0 and not return_start:
        raise HTTPException(status_code=400, detail="填写退报扣款时必须选择退报周期")
    if gross is not None:
        payload["amount_due"] = gross - deduction

    quantity = payload.get("invoice_quantity")
    unit_price = payload.get("invoice_unit_price")
    if quantity is not None and unit_price is not None:
        payload["invoice_amount"] = quantity * unit_price
    return payload


@router.get("", response_model=List[SettlementOut])
def list_settlements(
    partner_id: Optional[int] = None,
    direction: Optional[SettlementDirection] = None,
    status: Optional[SettlementStatus] = None,
    settlement_from: Optional[date] = None,
    settlement_to: Optional[date] = None,
    q: Optional[str] = Query(default=None, description="模糊匹配 结算单号 / 历史周期 / 发票号"),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    query = db.query(ChannelSettlement)
    if partner_id is not None:
        query = query.filter(ChannelSettlement.partner_id == partner_id)
    if direction is not None:
        query = query.filter(ChannelSettlement.direction == direction)
    if status is not None:
        query = query.filter(ChannelSettlement.status == status)
    if settlement_from is not None:
        query = query.filter(ChannelSettlement.settlement_end_date >= settlement_from)
    if settlement_to is not None:
        query = query.filter(ChannelSettlement.settlement_start_date <= settlement_to)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(or_(
            ChannelSettlement.settlement_no.ilike(like),
            ChannelSettlement.period.ilike(like),
            ChannelSettlement.invoice_no.ilike(like),
        ))
    rows = query.order_by(
        ChannelSettlement.settlement_end_date.desc(),
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
    partner = _validate_refs(db, data.partner_id, data.contract_id)
    payload = _validate_business(_normalize_strings(data.model_dump()))
    defaults = {
        "invoice_title": partner.invoice_title,
        "invoice_tax_no": partner.tax_no,
        "invoice_taxpayer_type": partner.taxpayer_type,
        "invoice_type": partner.default_invoice_type,
        "invoice_item_name": partner.default_invoice_content,
        "invoice_unit": partner.default_invoice_unit,
        "invoice_unit_price": partner.default_invoice_unit_price,
        "invoice_tax_rate": partner.default_tax_rate,
    }
    for field, value in defaults.items():
        if payload.get(field) is None:
            payload[field] = value
    # 默认单价可能由渠道档案补入，因此开票金额在补默认后再复核一次。
    _validate_business(payload)
    _validate_unique_no(db, payload.get("settlement_no"))
    s = ChannelSettlement(**payload, created_by=admin.id)
    db.add(s)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="结算单号已存在")
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
    patch = _normalize_strings(data.model_dump(exclude_unset=True))
    new_partner = patch.get("partner_id", s.partner_id)
    new_contract = patch.get("contract_id", s.contract_id)
    if "partner_id" in patch or "contract_id" in patch:
        _validate_refs(db, new_partner, new_contract)
    _validate_unique_no(
        db,
        patch.get("settlement_no", s.settlement_no),
        exclude_id=s.id,
    )
    merged = {
        field: patch.get(field, getattr(s, field))
        for field in (
            "period",
            "settlement_start_date",
            "settlement_end_date",
            "return_start_date",
            "return_end_date",
            "gross_amount",
            "return_deduction_amount",
            "amount_due",
            "invoice_quantity",
            "invoice_unit_price",
            "invoice_amount",
        )
    }
    _validate_business(merged)
    if "gross_amount" in patch or "return_deduction_amount" in patch:
        patch["amount_due"] = (
            merged["gross_amount"] - (merged["return_deduction_amount"] or Decimal("0"))
            if merged["gross_amount"] is not None
            else None
        )
    if "invoice_quantity" in patch or "invoice_unit_price" in patch:
        patch["invoice_amount"] = (
            merged["invoice_quantity"] * merged["invoice_unit_price"]
            if merged["invoice_quantity"] is not None
            and merged["invoice_unit_price"] is not None
            else None
        )
    for field, value in patch.items():
        setattr(s, field, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="结算单号已存在")
    db.refresh(s)
    return _to_out(s)


@router.delete("/{settlement_id}", status_code=204)
def delete_settlement(
    settlement_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    s = _get_or_404(db, settlement_id)
    stored_paths = {item.path for item in s.attachments}
    if s.attachment_path:
        stored_paths.add(s.attachment_path)
    db.delete(s)
    db.commit()
    for stored_path in stored_paths:
        attachment_service.delete_file(stored_path)


# --------------------------------------------------------------------------- #
# 多附件（结算单 / 开票申请 / 发票 / 其他）
# --------------------------------------------------------------------------- #
def _validate_filename(file: UploadFile) -> str:
    filename = (file.filename or "").strip() or "settlement"
    suffix = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(status_code=400, detail="仅支持 PDF / JPG / PNG / XLS / XLSX")
    return filename


async def _store_attachment(
    *,
    settlement: ChannelSettlement,
    category: SettlementAttachmentCategory,
    file: UploadFile,
    admin: User,
    db: Session,
) -> None:
    filename = _validate_filename(file)
    content = await read_upload(file, label="附件")
    stored_path = attachment_service.store_file(ATTACHMENT_CATEGORY, filename, content)
    attachment = SettlementAttachment(
        settlement_id=settlement.id,
        category=category,
        filename=filename,
        path=stored_path,
        content_type=file.content_type,
        created_by=admin.id,
    )
    db.add(attachment)
    try:
        db.commit()
    except Exception:
        with suppress(Exception):
            db.rollback()
        attachment_service.delete_file(stored_path)
        raise
    db.refresh(settlement)


def _get_attachment_or_404(
    db: Session,
    settlement_id: int,
    attachment_id: int,
) -> SettlementAttachment:
    attachment = db.query(SettlementAttachment).filter(
        SettlementAttachment.id == attachment_id,
        SettlementAttachment.settlement_id == settlement_id,
    ).first()
    if attachment is None:
        raise HTTPException(status_code=404, detail="结算附件不存在")
    return attachment


@router.post("/{settlement_id}/attachments", response_model=SettlementOut)
async def upload_typed_attachment(
    settlement_id: int,
    category: SettlementAttachmentCategory = SettlementAttachmentCategory.other,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    s = _get_or_404(db, settlement_id)
    await _store_attachment(
        settlement=s, category=category, file=file, admin=admin, db=db
    )
    return _to_out(s)


@router.get("/{settlement_id}/attachments/{attachment_id}")
def download_typed_attachment(
    settlement_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    _get_or_404(db, settlement_id)
    attachment = _get_attachment_or_404(db, settlement_id, attachment_id)
    try:
        path = attachment_service.resolve_path(attachment.path)
    except ValueError:
        raise HTTPException(status_code=404, detail="附件路径无效")
    if not path.exists():
        raise HTTPException(status_code=404, detail="附件文件丢失")
    return FileResponse(path, filename=attachment.filename)


@router.delete("/{settlement_id}/attachments/{attachment_id}", response_model=SettlementOut)
def delete_typed_attachment(
    settlement_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    s = _get_or_404(db, settlement_id)
    attachment = _get_attachment_or_404(db, settlement_id, attachment_id)
    old_path = attachment.path
    db.delete(attachment)
    db.commit()
    db.refresh(s)
    attachment_service.delete_file(old_path)
    return _to_out(s)


# 旧单附件接口保留一版，便于历史前端平滑升级。
@router.post("/{settlement_id}/attachment", response_model=SettlementOut)
async def upload_attachment(
    settlement_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    s = _get_or_404(db, settlement_id)
    await _store_attachment(
        settlement=s,
        category=SettlementAttachmentCategory.other,
        file=file,
        admin=admin,
        db=db,
    )
    return _to_out(s)


@router.get("/{settlement_id}/attachment")
def download_attachment(
    settlement_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    s = _get_or_404(db, settlement_id)
    if s.attachments:
        attachment = s.attachments[-1]
        path_value, filename = attachment.path, attachment.filename
    elif s.attachment_path:
        path_value = s.attachment_path
        filename = s.attachment_filename or "settlement"
    else:
        raise HTTPException(status_code=404, detail="该结算记录没有附件")
    try:
        path = attachment_service.resolve_path(path_value)
    except ValueError:
        raise HTTPException(status_code=404, detail="附件路径无效")
    if not path.exists():
        raise HTTPException(status_code=404, detail="附件文件丢失")
    return FileResponse(path, filename=filename)


@router.delete("/{settlement_id}/attachment", response_model=SettlementOut)
def delete_attachment(
    settlement_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    s = _get_or_404(db, settlement_id)
    paths = {item.path for item in s.attachments}
    if s.attachment_path:
        paths.add(s.attachment_path)
    for item in list(s.attachments):
        db.delete(item)
    s.attachment_path = None
    s.attachment_filename = None
    db.commit()
    db.refresh(s)
    for path in paths:
        attachment_service.delete_file(path)
    return _to_out(s)
