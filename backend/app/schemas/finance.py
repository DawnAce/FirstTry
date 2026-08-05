"""Pydantic schemas for 财务管理（订单发票 + 渠道结算）。

订单发票以**订单为中心**的工作台行(``InvoiceOrderRow``)由 ``finance_service`` 组装；
``Invoice*`` / ``Settlement*`` 是 admin CRUD 载荷。``SettlementOut`` 含派生 ``partner_name`` /
``has_attachment``，由 api 组装。
"""

from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, Field

from app.models.channel_settlement import (
    SettlementAttachmentCategory,
    SettlementDirection,
    SettlementInvoiceStatus,
    SettlementPartyType,
    SettlementPaymentStatus,
    SettlementStatus,
    SettlementType,
)
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
    attachment_filename: Optional[str] = None
    has_attachment: bool = False
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
    invoice_recipient_email: Optional[str] = None
    normal_invoiced_amount: Decimal
    remaining_invoice_amount: Decimal
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
    issued_count: int               # 已开票总数（不受筛选影响）


# --------------------------------------------------------------------------- #
# 渠道结算 ChannelSettlement
# --------------------------------------------------------------------------- #
class SettlementBase(BaseModel):
    partner_id: int
    contract_id: Optional[int] = None
    direction: SettlementDirection = SettlementDirection.payable
    party_type: SettlementPartyType = SettlementPartyType.channel
    settlement_type: Optional[SettlementType] = None
    external_no: Optional[str] = Field(default=None, max_length=128)
    # 兼容旧客户端；新客户端使用 external_no，系统编号不接受客户端赋值。
    settlement_no: Optional[str] = Field(default=None, max_length=64)
    period: Optional[str] = Field(default=None, max_length=32)
    settlement_start_date: Optional[date] = None
    settlement_end_date: Optional[date] = None
    return_start_date: Optional[date] = None
    return_end_date: Optional[date] = None
    gross_amount: Optional[Decimal] = Field(default=None, ge=0)
    return_deduction_amount: Decimal = Field(default=Decimal("0"), ge=0)
    amount_due: Optional[Decimal] = None
    paid_amount: Optional[Decimal] = Field(default=None, ge=0)
    paid_date: Optional[date] = None
    on_time: Optional[bool] = None
    invoice_received: bool = False
    invoice_status: SettlementInvoiceStatus = SettlementInvoiceStatus.unissued
    payment_status: SettlementPaymentStatus = SettlementPaymentStatus.unpaid
    invoice_no: Optional[str] = Field(default=None, max_length=64)
    invoice_title: Optional[str] = Field(default=None, max_length=255)
    invoice_tax_no: Optional[str] = Field(default=None, max_length=64)
    invoice_taxpayer_type: Optional[str] = Field(default=None, max_length=32)
    invoice_type: Optional[str] = Field(default=None, max_length=32)
    invoice_item_name: Optional[str] = Field(default=None, max_length=255)
    invoice_unit: Optional[str] = Field(default=None, max_length=32)
    invoice_quantity: Optional[Decimal] = Field(default=None, ge=0)
    invoice_unit_price: Optional[Decimal] = Field(default=None, ge=0)
    invoice_tax_rate: Optional[Decimal] = Field(default=None, ge=0, le=1)
    invoice_amount: Optional[Decimal] = Field(default=None, ge=0)
    status: SettlementStatus = SettlementStatus.pending
    notes: Optional[str] = None


class SettlementCreate(SettlementBase):
    pass


class SettlementUpdate(BaseModel):
    partner_id: Optional[int] = None
    contract_id: Optional[int] = None
    direction: Optional[SettlementDirection] = None
    party_type: Optional[SettlementPartyType] = None
    settlement_type: Optional[SettlementType] = None
    external_no: Optional[str] = Field(default=None, max_length=128)
    settlement_no: Optional[str] = Field(default=None, max_length=64)
    period: Optional[str] = Field(default=None, max_length=32)
    settlement_start_date: Optional[date] = None
    settlement_end_date: Optional[date] = None
    return_start_date: Optional[date] = None
    return_end_date: Optional[date] = None
    gross_amount: Optional[Decimal] = Field(default=None, ge=0)
    return_deduction_amount: Optional[Decimal] = Field(default=None, ge=0)
    amount_due: Optional[Decimal] = None
    paid_amount: Optional[Decimal] = Field(default=None, ge=0)
    paid_date: Optional[date] = None
    on_time: Optional[bool] = None
    invoice_received: Optional[bool] = None
    invoice_status: Optional[SettlementInvoiceStatus] = None
    payment_status: Optional[SettlementPaymentStatus] = None
    invoice_no: Optional[str] = Field(default=None, max_length=64)
    invoice_title: Optional[str] = Field(default=None, max_length=255)
    invoice_tax_no: Optional[str] = Field(default=None, max_length=64)
    invoice_taxpayer_type: Optional[str] = Field(default=None, max_length=32)
    invoice_type: Optional[str] = Field(default=None, max_length=32)
    invoice_item_name: Optional[str] = Field(default=None, max_length=255)
    invoice_unit: Optional[str] = Field(default=None, max_length=32)
    invoice_quantity: Optional[Decimal] = Field(default=None, ge=0)
    invoice_unit_price: Optional[Decimal] = Field(default=None, ge=0)
    invoice_tax_rate: Optional[Decimal] = Field(default=None, ge=0, le=1)
    invoice_amount: Optional[Decimal] = Field(default=None, ge=0)
    status: Optional[SettlementStatus] = None
    notes: Optional[str] = None


class SettlementAttachmentOut(BaseModel):
    id: int
    category: SettlementAttachmentCategory
    filename: str
    content_type: Optional[str] = None
    file_size: Optional[int] = None
    sha256: Optional[str] = None
    created_at: datetime


class SettlementOut(SettlementBase):
    id: int
    system_no: str
    partner_name: str = ""
    attachment_filename: Optional[str] = None
    has_attachment: bool = False
    attachments: List[SettlementAttachmentOut] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SettlementExcelPreviewOut(BaseModel):
    recognized: bool
    parser_version: str
    filename: str
    supplier_name: Optional[str] = None
    external_no: Optional[str] = None
    settlement_start_date: Optional[date] = None
    settlement_end_date: Optional[date] = None
    return_start_date: Optional[date] = None
    return_end_date: Optional[date] = None
    gross_amount: Optional[Decimal] = None
    return_deduction_amount: Decimal = Decimal("0")
    amount_due: Optional[Decimal] = None
    invoice_item_name: Optional[str] = None
    invoice_quantity: Optional[Decimal] = None
    invoice_unit_price: Optional[Decimal] = None
    invoice_amount: Optional[Decimal] = None
    detail_count: int = 0
    return_detail_count: int = 0
    warnings: List[str] = Field(default_factory=list)
