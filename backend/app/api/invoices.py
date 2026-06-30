"""订单发票 REST API（财务 · 发票登记 / 退款冲红）。

挂在 ``/api/invoices``（auth 在 main.py include 时统一注入）。读对所有登录用户开放；
增 / 改 / 删为敏感写操作，要求 ``require_admin``。工作台聚合逻辑在 ``finance_service``。

* ``GET  /api/invoices/orders`` —— 以订单为中心的发票工作台（待开票 / 已开票 / 需冲红）
* ``POST /api/invoices``        —— 登记一条发票（正票 / 红冲）
* ``PUT  /api/invoices/{id}``   —— 修改发票登记
* ``DELETE /api/invoices/{id}`` —— 删除发票登记
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import Invoice, Order, User
from app.schemas.finance import (
    InvoiceCreate,
    InvoiceOrdersOut,
    InvoiceOut,
    InvoiceUpdate,
)
from app.services import finance_service

router = APIRouter(prefix="/api/invoices", tags=["invoices"])


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
    if db.query(Order).filter(Order.id == data.order_id).first() is None:
        raise HTTPException(status_code=400, detail=f"订单 {data.order_id} 不存在")
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
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if invoice is None:
        raise HTTPException(status_code=404, detail=f"发票 {invoice_id} 不存在")
    for field, value in data.model_dump(exclude_unset=True).items():
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
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if invoice is None:
        raise HTTPException(status_code=404, detail=f"发票 {invoice_id} 不存在")
    db.delete(invoice)
    db.commit()
