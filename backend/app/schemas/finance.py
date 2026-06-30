"""Pydantic schemas for 财务管理（订单发票 + 渠道结算）。

订单发票以**订单为中心**的工作台行(``InvoiceOrderRow``)由 ``finance_service`` 组装；
``Invoice*`` / ``Settlement*`` 是 admin CRUD 载荷。``SettlementOut`` 含派生 ``partner_name`` /
``has_attachment``，由 api 组装。
"""

from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, Field

from app.models.channel_settlement import SettlementStatus
from app.models.invoice import InvoiceType


# --------------------------------------------------------------------------- #
# 订单发票 Invoice
# --------------------------------------------------------------------------- #
class InvoiceBase(BaseModel):
    order_id: int
    invoice_type: InvoiceType = InvoiceType.normal
    invoice_no: Optional[str] = Field(default=None, max_length=64)
    amount: Optional[Decimal] = None
    issued_date: Optional[date] = None
    buyer_title: Optional[str] = None
    tax_no: Optional[str] = Field(default=None, max_length=64)
    notes: Optional[str] = None


class InvoiceCreate(InvoiceBase):
    pass


class InvoiceUpdate(BaseModel):
    invoice_type: Optional[InvoiceType] = None
    invoice_no: Optional[str] = Field(default=None, max_length=64)
    amount: Optional[Decimal] = None
    issued_date: Optional[date] = None
    buyer_title: Optional[str] = None
    tax_no: Optional[str] = Field(default=None, max_length=64)
    notes: Optional[str] = None


class InvoiceOut(InvoiceBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# 以订单为中心的发票工作台行
class InvoiceOrderRow(BaseModel):
    order_id: int
    order_code: Optional[str] = None
    payer_name: str
    order_date: date
    total_amount: Decimal
    refunded_amount: Decimal
    invoice_required: bool
    invoice_title: Optional[str] = None
    invoice_tax_no: Optional[str] = None
    invoices: List[InvoiceOut]
    # pending(待开票) | issued(已开票) | needs_red_reversal(需冲红)
    invoice_state: str
    needs_red_reversal: bool
    # 订单是否已作废——已作废单仅在「仍需冲红」(已开正票+退款未冲红)时才进工作台，需提示。
    order_voided: bool = False


class InvoiceOrdersOut(BaseModel):
    rows: List[InvoiceOrderRow]
    total: int                      # 当前筛选后行数
    pending_count: int              # 待开票总数（不受筛选影响）
    needs_red_reversal_count: int   # 需冲红总数（不受筛选影响）


# --------------------------------------------------------------------------- #
# 渠道结算 ChannelSettlement
# --------------------------------------------------------------------------- #
class SettlementBase(BaseModel):
    partner_id: int
    contract_id: Optional[int] = None
    period: Optional[str] = Field(default=None, max_length=32)
    amount_due: Optional[Decimal] = Field(default=None, ge=0)
    paid_amount: Optional[Decimal] = Field(default=None, ge=0)
    paid_date: Optional[date] = None
    on_time: Optional[bool] = None
    invoice_received: bool = False
    invoice_no: Optional[str] = Field(default=None, max_length=64)
    status: SettlementStatus = SettlementStatus.pending
    notes: Optional[str] = None


class SettlementCreate(SettlementBase):
    pass


class SettlementUpdate(BaseModel):
    partner_id: Optional[int] = None
    contract_id: Optional[int] = None
    period: Optional[str] = Field(default=None, max_length=32)
    amount_due: Optional[Decimal] = Field(default=None, ge=0)
    paid_amount: Optional[Decimal] = Field(default=None, ge=0)
    paid_date: Optional[date] = None
    on_time: Optional[bool] = None
    invoice_received: Optional[bool] = None
    invoice_no: Optional[str] = Field(default=None, max_length=64)
    status: Optional[SettlementStatus] = None
    notes: Optional[str] = None


class SettlementOut(SettlementBase):
    id: int
    partner_name: str = ""
    attachment_filename: Optional[str] = None
    has_attachment: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
