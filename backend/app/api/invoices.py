"""订单发票 REST API（财务 · 发票登记 / 退款冲红）。

挂在 ``/api/invoices``（auth 在 main.py include 时统一注入）。读对所有登录用户开放；
增 / 改 / 删为敏感写操作，要求 ``require_admin``。工作台聚合逻辑在 ``finance_service``。

* ``GET  /api/invoices/orders`` —— 以订单为中心的发票工作台（待开票 / 已开票 / 需冲红）
* ``POST /api/invoices``        —— 登记一条发票（正票 / 红冲）
* ``PUT  /api/invoices/{id}``   —— 修改发票登记
* ``DELETE /api/invoices/{id}`` —— 删除发票登记
* ``POST /api/invoices/{id}/attachment`` —— 上传 / 替换电子发票（选填）
* ``GET  /api/invoices/{id}/attachment`` —— 预览 / 下载电子发票
* ``DELETE /api/invoices/{id}/attachment`` —— 删除电子发票附件
"""

import mimetypes
from contextlib import suppress
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import Invoice, InvoiceType, Order, User
from app.schemas.finance import (
    InvoiceCreate,
    InvoiceOrdersOut,
    InvoiceOut,
    InvoiceUpdate,
)
from app.services import finance_service
from app.services import attachment_service
from app.upload import read_upload

router = APIRouter(prefix="/api/invoices", tags=["invoices"])

ATTACHMENT_CATEGORY = "invoices"
ALLOWED_SUFFIXES = {".pdf", ".jpg", ".jpeg", ".png"}


def _get_or_404(db: Session, invoice_id: int) -> Invoice:
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if invoice is None:
        raise HTTPException(status_code=404, detail=f"发票 {invoice_id} 不存在")
    return invoice


def _validate_normal_amount(
    db: Session,
    order: Order,
    amount: Optional[Decimal],
    *,
    exclude_invoice_id: Optional[int] = None,
) -> None:
    """正票可分次登记，但累计金额不能超过订单应开金额。"""
    if amount is None or amount <= 0:
        raise HTTPException(status_code=400, detail="开票金额必须大于 0")

    query = db.query(Invoice).filter(
        Invoice.order_id == order.id,
        Invoice.invoice_type == InvoiceType.normal,
    )
    if exclude_invoice_id is not None:
        query = query.filter(Invoice.id != exclude_invoice_id)
    existing = query.all()
    if any(invoice.amount is None for invoice in existing):
        raise HTTPException(
            status_code=400,
            detail="该订单已有未填写金额的正票，请先删除或补全原记录",
        )

    already_invoiced = sum((invoice.amount or Decimal("0") for invoice in existing), Decimal("0"))
    remaining = max(Decimal(str(order.total_amount or 0)) - already_invoiced, Decimal("0"))
    if remaining == 0:
        raise HTTPException(status_code=400, detail="该订单已足额开票，不能继续登记正票")
    if amount > remaining:
        raise HTTPException(
            status_code=400,
            detail=f"开票金额超过待开金额 ¥{remaining:.2f}",
        )


@router.get("/orders", response_model=InvoiceOrdersOut)
def invoice_orders(
    status: Optional[str] = None,
    q: Optional[str] = None,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """发票工作台：需开票 / 已登记发票的订单 + 每单发票 + 派生状态。

    ``status`` ∈ {pending, issued, needs_red_reversal} 过滤；``q`` 模糊匹配 订单号 / 付款方。
    """
    return finance_service.list_invoice_orders(db, status=status, q=q)


@router.post("", response_model=InvoiceOut, status_code=201)
def create_invoice(
    data: InvoiceCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    # 锁订单行，避免两个并发请求同时按相同的待开金额通过校验。
    order = db.query(Order).filter(Order.id == data.order_id).with_for_update().first()
    if order is None:
        raise HTTPException(status_code=400, detail=f"订单 {data.order_id} 不存在")
    if data.invoice_type == InvoiceType.normal:
        _validate_normal_amount(db, order, data.amount)
    invoice = Invoice(**data.model_dump(), created_by=admin.id)
    db.add(invoice)
    db.commit()
    db.refresh(invoice)
    return invoice


@router.put("/{invoice_id}", response_model=InvoiceOut)
def update_invoice(
    invoice_id: int,
    data: InvoiceUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    invoice = _get_or_404(db, invoice_id)
    updates = data.model_dump(exclude_unset=True)
    next_type = updates.get("invoice_type", invoice.invoice_type)
    next_amount = updates.get("amount", invoice.amount)
    if next_type == InvoiceType.normal:
        order = db.query(Order).filter(Order.id == invoice.order_id).with_for_update().first()
        _validate_normal_amount(db, order, next_amount, exclude_invoice_id=invoice.id)
    for field, value in updates.items():
        setattr(invoice, field, value)
    db.commit()
    db.refresh(invoice)
    return invoice


@router.delete("/{invoice_id}", status_code=204)
def delete_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    invoice = _get_or_404(db, invoice_id)
    stored_path = invoice.attachment_path
    db.delete(invoice)
    db.commit()
    attachment_service.delete_file(stored_path)


# --------------------------------------------------------------------------- #
# 电子发票附件（选填）
# --------------------------------------------------------------------------- #
@router.post("/{invoice_id}/attachment", response_model=InvoiceOut)
async def upload_attachment(
    invoice_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    invoice = _get_or_404(db, invoice_id)
    filename = (file.filename or "").strip() or "invoice"
    suffix = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(status_code=400, detail="仅支持 PDF / JPG / PNG")

    content = await read_upload(file, label="电子发票")
    old_path = invoice.attachment_path
    stored_path = attachment_service.store_file(ATTACHMENT_CATEGORY, filename, content)
    invoice.attachment_path = stored_path
    invoice.attachment_filename = filename
    try:
        db.commit()
    except Exception:
        with suppress(Exception):
            db.rollback()
        attachment_service.delete_file(stored_path)
        raise
    db.refresh(invoice)
    if old_path and old_path != stored_path:
        attachment_service.delete_file(old_path)
    return invoice


@router.get("/{invoice_id}/attachment")
def download_attachment(
    invoice_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    invoice = _get_or_404(db, invoice_id)
    if not invoice.attachment_path:
        raise HTTPException(status_code=404, detail="该发票记录没有电子发票附件")
    try:
        path = attachment_service.resolve_path(invoice.attachment_path)
    except ValueError:
        raise HTTPException(status_code=404, detail="附件路径无效")
    if not path.exists():
        raise HTTPException(status_code=404, detail="电子发票文件丢失")
    filename = invoice.attachment_filename or path.name
    media_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return FileResponse(
        path,
        filename=filename,
        media_type=media_type,
        content_disposition_type="inline",
    )


@router.delete("/{invoice_id}/attachment", response_model=InvoiceOut)
def delete_attachment(
    invoice_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    invoice = _get_or_404(db, invoice_id)
    old_path = invoice.attachment_path
    invoice.attachment_path = None
    invoice.attachment_filename = None
    db.commit()
    db.refresh(invoice)
    attachment_service.delete_file(old_path)
    return invoice
