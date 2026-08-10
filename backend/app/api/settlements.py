"""渠道结算 REST API（财务 · 应收/应付对账、结款、开票与凭证归档）。

挂在 ``/api/settlements``（auth 在 main.py include 时统一注入）。读 / 下载对所有登录用户开放；
增 / 改 / 删 / 传 / 删附件要求 ``require_admin``。复用模块二的 ``partners`` / ``contracts`` 与
``attachment_service``（结算单 / 进项发票扫描件落 backend/uploads/settlements/，鉴权下载）。
"""

from contextlib import suppress
import json
from datetime import date
from decimal import Decimal
from typing import List, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import (
    ChannelSettlement,
    Contract,
    OperationLog,
    Partner,
    SalesModePolicy,
    SettlementAttachment,
    SettlementAttachmentCategory,
    SettlementDirection,
    SettlementInvoiceStatus,
    SettlementPartyType,
    SettlementPaymentStatus,
    SettlementStatus,
    SettlementType,
    User,
)
from app.schemas.finance import (
    SettlementAttachmentOut,
    SettlementCreate,
    SettlementExcelPreviewOut,
    SettlementHistoryOut,
    SettlementInvoiceRegister,
    SettlementOut,
    SettlementPaymentRegister,
    SettlementUpdate,
)
from app.services import attachment_service
from app.services.settlement_excel_parser import (
    audit_result,
    parse_settlement_excel,
)
from app.upload import read_upload

router = APIRouter(prefix="/api/settlements", tags=["settlements"])

ATTACHMENT_CATEGORY = "settlements"
ALLOWED_SUFFIXES = {".pdf", ".jpg", ".jpeg", ".png", ".xls", ".xlsx"}
NORMALIZED_TEXT_FIELDS = {
    "settlement_no",
    "external_no",
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
        file_size=attachment.file_size,
        sha256=attachment.sha256,
        is_primary=attachment.is_primary,
        recognized=attachment.recognized,
        recognition_parser_version=attachment.recognition_parser_version,
        recognition_result=attachment.recognition_result,
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
        party_type=s.party_type,
        settlement_type=s.settlement_type,
        system_no=s.system_no,
        external_no=s.external_no or s.settlement_no,
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
        invoice_status=s.invoice_status,
        payment_status=s.payment_status,
        invoice_no=s.invoice_no,
        invoice_date=s.invoice_date,
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


def _system_no(party_type: SettlementPartyType, settlement_id: int) -> str:
    code = "GR" if party_type == SettlementPartyType.individual else "QD"
    return f"JS-{code}-{date.today():%Y%m}-{settlement_id:06d}"


def _payment_status(amount_due: Optional[Decimal], paid_amount: Optional[Decimal]):
    paid = paid_amount or Decimal("0")
    if paid <= 0:
        return SettlementPaymentStatus.unpaid
    if amount_due is not None and paid >= amount_due:
        return SettlementPaymentStatus.paid
    return SettlementPaymentStatus.partial


def _validate_partner_business(partner: Partner, payload: dict) -> None:
    policy = partner.sales_mode_policy or SalesModePolicy.not_applicable
    if policy == SalesModePolicy.required and not payload.get("settlement_type"):
        raise HTTPException(status_code=400, detail="该渠道结算必须选择代销或包销")
    if policy == SalesModePolicy.not_applicable:
        payload["settlement_type"] = None


def _sync_legacy_status(settlement: ChannelSettlement) -> None:
    """兼容旧状态列；开票与收付款状态始终各自独立。"""
    if settlement.status == SettlementStatus.archived:
        return
    if settlement.payment_status == SettlementPaymentStatus.paid:
        settlement.status = SettlementStatus.paid
    elif settlement.invoice_status == SettlementInvoiceStatus.issued:
        settlement.status = SettlementStatus.invoiced
    else:
        settlement.status = SettlementStatus.pending


def _clear_settlement_recognition(settlement: ChannelSettlement) -> None:
    settlement.recognition_source_filename = None
    settlement.recognition_parser_version = None
    settlement.recognition_result = None


def _log_operation(
    db: Session,
    settlement: ChannelSettlement,
    user: User,
    action: str,
    changes: Optional[dict] = None,
) -> None:
    db.add(OperationLog(
        table_name="channel_settlements",
        record_id=settlement.id,
        record_name=settlement.system_no,
        action=action,
        changes=json.loads(json.dumps(changes or {}, default=str)),
        user_id=user.id,
        username=user.username,
    ))


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
    payload["payment_status"] = _payment_status(
        payload.get("amount_due"), payload.get("paid_amount")
    )
    if payload.get("invoice_received"):
        payload["invoice_status"] = SettlementInvoiceStatus.issued
        payload["status"] = SettlementStatus.invoiced
    return payload


def _new_settlement(data: SettlementCreate, db: Session, admin: User) -> ChannelSettlement:
    partner = _validate_refs(db, data.partner_id, data.contract_id)
    payload = _normalize_strings(data.model_dump())
    if not payload.get("external_no") and payload.get("settlement_no"):
        payload["external_no"] = payload["settlement_no"]
    payload = _validate_business(payload)
    _validate_partner_business(partner, payload)
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
    _validate_business(payload)
    settlement = ChannelSettlement(
        **payload,
        system_no=f"PENDING-{uuid4().hex}",
        created_by=admin.id,
    )
    db.add(settlement)
    db.flush()
    settlement.system_no = _system_no(settlement.party_type, settlement.id)
    _log_operation(db, settlement, admin, "create", {"system_no": settlement.system_no})
    return settlement


def _commit_created(db: Session, settlement: ChannelSettlement) -> SettlementOut:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="系统结算单号生成冲突，请重试")
    db.refresh(settlement)
    return _to_out(settlement)


@router.post("/import/preview", response_model=SettlementExcelPreviewOut)
async def preview_settlement_excel(
    file: UploadFile = File(...),
    _admin: User = Depends(require_admin),
):
    filename = _validate_filename(file)
    content = await read_upload(file, label="结算表格")
    return parse_settlement_excel(content, filename)


@router.get("", response_model=List[SettlementOut])
def list_settlements(
    partner_id: Optional[int] = None,
    direction: Optional[SettlementDirection] = None,
    party_type: Optional[SettlementPartyType] = None,
    settlement_type: Optional[SettlementType] = None,
    invoice_status: Optional[SettlementInvoiceStatus] = None,
    payment_status: Optional[SettlementPaymentStatus] = None,
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
    if party_type is not None:
        query = query.filter(ChannelSettlement.party_type == party_type)
    if settlement_type is not None:
        query = query.filter(ChannelSettlement.settlement_type == settlement_type)
    if invoice_status is not None:
        query = query.filter(ChannelSettlement.invoice_status == invoice_status)
    if payment_status is not None:
        query = query.filter(ChannelSettlement.payment_status == payment_status)
    if status is not None:
        query = query.filter(ChannelSettlement.status == status)
    if settlement_from is not None:
        query = query.filter(ChannelSettlement.settlement_end_date >= settlement_from)
    if settlement_to is not None:
        query = query.filter(ChannelSettlement.settlement_start_date <= settlement_to)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(or_(
            ChannelSettlement.system_no.ilike(like),
            ChannelSettlement.external_no.ilike(like),
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
    settlement = _new_settlement(data, db, admin)
    return _commit_created(db, settlement)


@router.post("/with-attachments", response_model=SettlementOut, status_code=201)
async def create_settlement_with_attachments(
    payload_json: str = Form(...),
    categories_json: str = Form("[]"),
    primary_attachment_index: Optional[int] = Form(default=None),
    files: Optional[List[UploadFile]] = File(default=None),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    try:
        data = SettlementCreate.model_validate_json(payload_json)
        category_values = json.loads(categories_json)
        categories = [SettlementAttachmentCategory(value) for value in category_values]
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=f"结算数据格式错误：{exc}")
    uploads = files or []
    if len(categories) != len(uploads):
        raise HTTPException(status_code=422, detail="附件类型与文件数量不一致")
    if primary_attachment_index is not None and not 0 <= primary_attachment_index < len(uploads):
        raise HTTPException(status_code=422, detail="主结算单序号无效")
    if primary_attachment_index is not None and categories[primary_attachment_index] != SettlementAttachmentCategory.settlement_sheet:
        raise HTTPException(status_code=422, detail="只有结算单附件可设为主结算单")
    if primary_attachment_index is None:
        primary_attachment_index = next(
            (index for index, category in enumerate(categories)
             if category == SettlementAttachmentCategory.settlement_sheet),
            None,
        )

    prepared: list[tuple[SettlementAttachmentCategory, str, str | None, bytes, str]] = []
    seen_hashes: set[str] = set()
    for category, file in zip(categories, uploads):
        filename = _validate_filename(file)
        content = await read_upload(file, label="附件")
        digest = attachment_service.sha256_hex(content)
        if digest in seen_hashes:
            raise HTTPException(status_code=409, detail=f"附件 {filename} 重复")
        seen_hashes.add(digest)
        prepared.append((category, filename, file.content_type, content, digest))

    stored_paths: list[str] = []
    try:
        settlement = _new_settlement(data, db, admin)
        for index, (category, filename, content_type, content, digest) in enumerate(prepared):
            stored_path = attachment_service.store_file(
                ATTACHMENT_CATEGORY, filename, content
            )
            stored_paths.append(stored_path)
            attachment = SettlementAttachment(
                settlement_id=settlement.id,
                category=category,
                filename=filename,
                path=stored_path,
                content_type=content_type,
                file_size=len(content),
                sha256=digest,
                is_primary=index == primary_attachment_index,
                created_by=admin.id,
            )
            db.add(attachment)
            if category == SettlementAttachmentCategory.invoice:
                settlement.invoice_received = True
                settlement.invoice_status = SettlementInvoiceStatus.issued
                _sync_legacy_status(settlement)
            if attachment.is_primary and filename.lower().endswith(".xlsx"):
                parsed = parse_settlement_excel(content, filename)
                attachment.recognized = bool(parsed["recognized"])
                attachment.recognition_parser_version = parsed["parser_version"]
                attachment.recognition_result = audit_result(parsed)
                settlement.recognition_source_filename = filename
                settlement.recognition_parser_version = parsed["parser_version"]
                settlement.recognition_result = audit_result(parsed)
            _log_operation(db, settlement, admin, "attachment_upload", {
                "filename": filename,
                "category": category.value,
                "is_primary": attachment.is_primary,
            })
        return _commit_created(db, settlement)
    except Exception:
        with suppress(Exception):
            db.rollback()
        for stored_path in stored_paths:
            attachment_service.delete_file(stored_path)
        raise


@router.put("/{settlement_id}", response_model=SettlementOut)
def update_settlement(
    settlement_id: int,
    data: SettlementUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    s = _get_or_404(db, settlement_id)
    patch = _normalize_strings(data.model_dump(exclude_unset=True))
    if "party_type" in patch and patch["party_type"] != s.party_type:
        raise HTTPException(status_code=400, detail="结算对象类型生成编号后不可修改")
    if "settlement_no" in patch and "external_no" not in patch:
        patch["external_no"] = patch["settlement_no"]
    new_partner = patch.get("partner_id", s.partner_id)
    new_contract = patch.get("contract_id", s.contract_id)
    partner = _validate_refs(db, new_partner, new_contract)
    sales_mode_payload = {
        "settlement_type": patch.get("settlement_type", s.settlement_type)
    }
    _validate_partner_business(partner, sales_mode_payload)
    if partner.sales_mode_policy == SalesModePolicy.not_applicable:
        patch["settlement_type"] = None
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
            "paid_amount",
        )
    }
    _validate_business(merged)
    patch["payment_status"] = merged["payment_status"]
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
    if patch.get("invoice_received"):
        patch["invoice_status"] = SettlementInvoiceStatus.issued
        patch["status"] = SettlementStatus.invoiced
    elif patch.get("invoice_received") is False:
        patch["invoice_status"] = SettlementInvoiceStatus.unissued
    for field, value in patch.items():
        setattr(s, field, value)
    _sync_legacy_status(s)
    _log_operation(db, s, admin, "update", patch)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="结算数据冲突，请刷新后重试")
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
    is_primary: bool = False,
) -> None:
    filename = _validate_filename(file)
    content = await read_upload(file, label="附件")
    digest = attachment_service.sha256_hex(content)
    duplicate = db.query(SettlementAttachment).filter(
        SettlementAttachment.settlement_id == settlement.id,
        SettlementAttachment.sha256 == digest,
    ).first()
    if duplicate is not None:
        raise HTTPException(status_code=409, detail=f"附件 {filename} 已上传")
    stored_path = attachment_service.store_file(ATTACHMENT_CATEGORY, filename, content)
    if is_primary and category != SettlementAttachmentCategory.settlement_sheet:
        attachment_service.delete_file(stored_path)
        raise HTTPException(status_code=400, detail="只有结算单附件可设为主结算单")
    try:
        if is_primary:
            db.query(SettlementAttachment).filter(
                SettlementAttachment.settlement_id == settlement.id,
                SettlementAttachment.is_primary.is_(True),
            ).update({"is_primary": False}, synchronize_session=False)
            _clear_settlement_recognition(settlement)
        attachment = SettlementAttachment(
            settlement_id=settlement.id,
            category=category,
            filename=filename,
            path=stored_path,
            content_type=file.content_type,
            file_size=len(content),
            sha256=digest,
            is_primary=is_primary,
            created_by=admin.id,
        )
        db.add(attachment)
        if category == SettlementAttachmentCategory.invoice:
            settlement.invoice_received = True
            settlement.invoice_status = SettlementInvoiceStatus.issued
            _sync_legacy_status(settlement)
        if is_primary and filename.lower().endswith(".xlsx"):
            parsed = parse_settlement_excel(content, filename)
            attachment.recognized = bool(parsed["recognized"])
            attachment.recognition_parser_version = parsed["parser_version"]
            attachment.recognition_result = audit_result(parsed)
            settlement.recognition_source_filename = filename
            settlement.recognition_parser_version = parsed["parser_version"]
            settlement.recognition_result = audit_result(parsed)
        _log_operation(db, settlement, admin, "attachment_upload", {
            "filename": filename,
            "category": category.value,
            "is_primary": is_primary,
        })
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


def _reset_invoice_status_if_empty(db: Session, settlement: ChannelSettlement) -> None:
    invoice_count = db.query(SettlementAttachment).filter(
        SettlementAttachment.settlement_id == settlement.id,
        SettlementAttachment.category == SettlementAttachmentCategory.invoice,
    ).count()
    if invoice_count:
        return
    settlement.invoice_received = False
    settlement.invoice_status = SettlementInvoiceStatus.unissued
    _sync_legacy_status(settlement)


@router.post("/{settlement_id}/attachments", response_model=SettlementOut)
async def upload_typed_attachment(
    settlement_id: int,
    category: SettlementAttachmentCategory = SettlementAttachmentCategory.other,
    is_primary: bool = False,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    s = _get_or_404(db, settlement_id)
    await _store_attachment(
        settlement=s, category=category, file=file, admin=admin, db=db,
        is_primary=is_primary,
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
    admin: User = Depends(require_admin),
):
    s = _get_or_404(db, settlement_id)
    attachment = _get_attachment_or_404(db, settlement_id, attachment_id)
    old_path = attachment.path
    was_primary = attachment.is_primary
    db.delete(attachment)
    db.flush()
    if attachment.category == SettlementAttachmentCategory.invoice:
        _reset_invoice_status_if_empty(db, s)
    if was_primary:
        _clear_settlement_recognition(s)
    _log_operation(db, s, admin, "attachment_delete", {
        "filename": attachment.filename,
        "category": attachment.category.value,
    })
    db.commit()
    db.refresh(s)
    attachment_service.delete_file(old_path)
    return _to_out(s)


@router.put("/{settlement_id}/attachments/{attachment_id}", response_model=SettlementOut)
def update_typed_attachment(
    settlement_id: int,
    attachment_id: int,
    category: Optional[SettlementAttachmentCategory] = None,
    is_primary: Optional[bool] = None,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    s = _get_or_404(db, settlement_id)
    attachment = _get_attachment_or_404(db, settlement_id, attachment_id)
    old_category = attachment.category
    new_category = category or old_category
    if is_primary is True and new_category != SettlementAttachmentCategory.settlement_sheet:
        raise HTTPException(status_code=400, detail="只有结算单附件可设为主结算单")
    attachment.category = new_category
    if new_category != SettlementAttachmentCategory.settlement_sheet:
        attachment.is_primary = False
    if is_primary is not None and new_category == SettlementAttachmentCategory.settlement_sheet:
        if is_primary:
            db.query(SettlementAttachment).filter(
                SettlementAttachment.settlement_id == s.id,
                SettlementAttachment.id != attachment.id,
            ).update({"is_primary": False}, synchronize_session=False)
        attachment.is_primary = is_primary

    if old_category == SettlementAttachmentCategory.settlement_sheet and new_category != old_category:
        attachment.recognized = None
        attachment.recognition_parser_version = None
        attachment.recognition_result = None
        if s.recognition_source_filename == attachment.filename:
            _clear_settlement_recognition(s)

    if new_category == SettlementAttachmentCategory.invoice:
        s.invoice_received = True
        s.invoice_status = SettlementInvoiceStatus.issued
        _sync_legacy_status(s)
    if old_category == SettlementAttachmentCategory.invoice and new_category != old_category:
        db.flush()
        _reset_invoice_status_if_empty(db, s)

    if attachment.is_primary:
        _clear_settlement_recognition(s)
    if attachment.is_primary and attachment.filename.lower().endswith(".xlsx"):
        try:
            path = attachment_service.resolve_path(attachment.path)
            parsed = parse_settlement_excel(path.read_bytes(), attachment.filename)
            attachment.recognized = bool(parsed["recognized"])
            attachment.recognition_parser_version = parsed["parser_version"]
            attachment.recognition_result = audit_result(parsed)
            s.recognition_source_filename = attachment.filename
            s.recognition_parser_version = parsed["parser_version"]
            s.recognition_result = audit_result(parsed)
        except (OSError, ValueError):
            attachment.recognized = False

    _log_operation(db, s, admin, "attachment_update", {
        "filename": attachment.filename,
        "category": new_category.value,
        "is_primary": attachment.is_primary,
    })
    db.commit()
    db.refresh(s)
    return _to_out(s)


@router.post("/{settlement_id}/invoice", response_model=SettlementOut)
def register_settlement_invoice(
    settlement_id: int,
    data: SettlementInvoiceRegister,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    s = _get_or_404(db, settlement_id)
    has_invoice_file = db.query(SettlementAttachment.id).filter(
        SettlementAttachment.settlement_id == settlement_id,
        SettlementAttachment.category == SettlementAttachmentCategory.invoice,
    ).first()
    if has_invoice_file is None:
        raise HTTPException(status_code=400, detail="登记开票前必须先上传发票文件")
    payload = data.model_dump()
    note = payload.pop("notes", None)
    if payload.get("invoice_amount") is None:
        quantity = payload.get("invoice_quantity")
        unit_price = payload.get("invoice_unit_price")
        if quantity is not None and unit_price is not None:
            payload["invoice_amount"] = quantity * unit_price
    for field, value in payload.items():
        setattr(s, field, value)
    s.invoice_received = True
    s.invoice_status = SettlementInvoiceStatus.issued
    _sync_legacy_status(s)
    _log_operation(db, s, admin, "invoice_register", {**payload, "notes": note})
    db.commit()
    db.refresh(s)
    return _to_out(s)


@router.post("/{settlement_id}/payment", response_model=SettlementOut)
def register_settlement_payment(
    settlement_id: int,
    data: SettlementPaymentRegister,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    s = _get_or_404(db, settlement_id)
    previous = s.paid_amount or Decimal("0")
    total = previous + data.amount
    if s.amount_due is not None and total > s.amount_due:
        raise HTTPException(status_code=400, detail="本次金额加累计已结金额不能超过应结金额")
    s.paid_amount = total
    s.paid_date = data.paid_date
    s.on_time = data.on_time
    s.payment_status = _payment_status(s.amount_due, total)
    _sync_legacy_status(s)
    _log_operation(db, s, admin, "payment_register", {
        "amount": data.amount,
        "paid_amount": total,
        "paid_date": data.paid_date,
        "on_time": data.on_time,
        "notes": data.notes,
    })
    db.commit()
    db.refresh(s)
    return _to_out(s)


@router.get("/{settlement_id}/history", response_model=List[SettlementHistoryOut])
def settlement_history(
    settlement_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    _get_or_404(db, settlement_id)
    return db.query(OperationLog).filter(
        OperationLog.table_name == "channel_settlements",
        OperationLog.record_id == settlement_id,
    ).order_by(OperationLog.created_at.desc(), OperationLog.id.desc()).all()


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
        is_primary=False,
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
    admin: User = Depends(require_admin),
):
    s = _get_or_404(db, settlement_id)
    paths = {item.path for item in s.attachments}
    if s.attachment_path:
        paths.add(s.attachment_path)
    for item in list(s.attachments):
        db.delete(item)
    s.attachment_path = None
    s.attachment_filename = None
    db.flush()
    _reset_invoice_status_if_empty(db, s)
    _log_operation(db, s, admin, "attachment_delete_all", {"count": len(paths)})
    db.commit()
    db.refresh(s)
    for path in paths:
        attachment_service.delete_file(path)
    return _to_out(s)
