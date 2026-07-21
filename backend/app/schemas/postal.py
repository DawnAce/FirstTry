"""邮局投递 · Pydantic schemas（批次 / 明细行 / 生成 / 提交）。"""

from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, Field

from app.models.postal_delivery import PostalBatchStatus, PostalDeliverySourceType
from app.models.postal_complaint import PostalComplaintStatus


class BatchOut(BaseModel):
    id: int
    year: int
    month: int
    status: PostalBatchStatus
    generated_at: Optional[datetime] = None
    sent_at: Optional[datetime] = None
    row_count: int

    model_config = {"from_attributes": True}


class BatchRowOut(BaseModel):
    id: int
    snap_name: str
    snap_phone: Optional[str] = None
    snap_province: Optional[str] = None
    snap_city: Optional[str] = None
    snap_district: Optional[str] = None
    snap_address: str
    snap_postal_code: Optional[str] = None
    copies: int
    coverage_start_date: Optional[date] = None
    coverage_end_date: Optional[date] = None
    source_channel: Optional[str] = None
    distribution_unit_id: Optional[int] = None
    distribution_unit_name: Optional[str] = None
    salesperson: Optional[str] = None

    model_config = {"from_attributes": True}


class BatchDetailOut(BaseModel):
    batch: BatchOut
    rows: List[BatchRowOut]


class GenerateBatchIn(BaseModel):
    year: int = Field(ge=2000, le=2100)
    month: int = Field(ge=1, le=12)


class PostalCommitIn(BaseModel):
    session_id: str


class DeliveryOut(BaseModel):
    id: int
    year: int
    delivery_no: str
    order_id: Optional[int] = None
    external_order_no: Optional[str] = None
    recipient_name: str
    recipient_phone: Optional[str] = None
    recipient_province: Optional[str] = None
    recipient_city: Optional[str] = None
    recipient_district: Optional[str] = None
    recipient_address: str
    recipient_postal_code: Optional[str] = None
    product: Optional[str] = None
    copies: int
    amount: Optional[Decimal] = None
    coverage_start_date: Optional[date] = None
    coverage_end_date: Optional[date] = None
    source_channel: Optional[str] = None
    distribution_unit_id: Optional[int] = None
    distribution_unit_name: Optional[str] = None
    salesperson: Optional[str] = None
    remittance_name: Optional[str] = None
    source_type: Optional[PostalDeliverySourceType] = None

    model_config = {"from_attributes": True}


class DeliverySummary(BaseModel):
    total_copies: int = 0
    unit_count: int = 0
    missing_unit_count: int = 0


class DeliveryListOut(BaseModel):
    rows: List[DeliveryOut]
    total: int
    summary: DeliverySummary = DeliverySummary()


class ComplaintOut(BaseModel):
    id: int
    postal_delivery_id: Optional[int] = None
    order_id: Optional[int] = None
    external_order_no: Optional[str] = None
    complaint_date: Optional[date] = None
    year: Optional[int] = None
    missing_issues: Optional[str] = None
    handling: Optional[str] = None
    routed_label: Optional[str] = None
    routed_unit_id: Optional[int] = None
    routed_unit_name: Optional[str] = None
    follow_up: Optional[str] = None
    handling_count: Optional[int] = None
    status: PostalComplaintStatus
    first_handler: Optional[str] = None
    snap_name: Optional[str] = None
    snap_phone: Optional[str] = None
    snap_address: Optional[str] = None
    snap_postal_code: Optional[str] = None
    notes: Optional[str] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ComplaintSummary(BaseModel):
    open: int = 0
    in_progress: int = 0
    resolved: int = 0


class ComplaintListOut(BaseModel):
    rows: List[ComplaintOut]
    total: int
    summary: ComplaintSummary = ComplaintSummary()


class AddressChangeOut(BaseModel):
    id: int
    postal_delivery_id: Optional[int] = None
    order_id: Optional[int] = None
    external_order_no: Optional[str] = None
    change_date: Optional[date] = None
    old_name: Optional[str] = None
    old_phone: Optional[str] = None
    old_address: Optional[str] = None
    old_copies: Optional[int] = None
    new_name: Optional[str] = None
    new_phone: Optional[str] = None
    new_address: Optional[str] = None
    new_copies: Optional[int] = None
    original_start_month: Optional[str] = None
    effective_start_month: Optional[str] = None
    handling: Optional[str] = None
    routed_label: Optional[str] = None
    applied_to_order: bool
    applied_by: Optional[int] = None
    applied_at: Optional[datetime] = None
    notes: Optional[str] = None

    model_config = {"from_attributes": True}


class AddressChangeSummary(BaseModel):
    pending_apply: int = 0
    unmatched: int = 0
    applied: int = 0


class AddressChangeListOut(BaseModel):
    rows: List[AddressChangeOut]
    total: int
    summary: AddressChangeSummary = AddressChangeSummary()


class FollowUpOut(BaseModel):
    id: int
    postal_delivery_id: Optional[int] = None
    order_id: Optional[int] = None
    external_order_no: Optional[str] = None
    follow_up_date: Optional[date] = None
    batch_label: Optional[str] = None
    result: Optional[str] = None
    snap_name: Optional[str] = None

    model_config = {"from_attributes": True}


class FollowUpListOut(BaseModel):
    rows: List[FollowUpOut]
    total: int


class FinanceOut(BaseModel):
    id: int
    order_id: Optional[int] = None
    external_order_no: Optional[str] = None
    link_by: Optional[str] = None
    payer_name: Optional[str] = None
    product: Optional[str] = None
    copies: Optional[int] = None
    amount: Optional[Decimal] = None
    fee_amount: Optional[Decimal] = None
    net_amount: Optional[Decimal] = None
    collected_at: Optional[date] = None
    invoiced_amount: Optional[Decimal] = None
    buyer_title: Optional[str] = None
    tax_no: Optional[str] = None
    invoice_recipient: Optional[str] = None
    tax_category: Optional[str] = None
    platform: Optional[str] = None
    notes: Optional[str] = None

    model_config = {"from_attributes": True}


class FinanceSummary(BaseModel):
    total_amount: float = 0
    total_net: float = 0
    unlinked_count: int = 0


class FinanceListOut(BaseModel):
    rows: List[FinanceOut]
    total: int
    summary: FinanceSummary = FinanceSummary()


# =====================================================================
# 手工 CRUD 入参（Create / Update）+ 投诉处理流程
#
# 手工新增复用导入时的派生逻辑（编号去零关联投递记录、routed_label 归一、挂单、net=金额-手续费）——
# 见各 service 的 create_*。Update 用 exclude_unset 局部更新（缺省字段不动）。
# =====================================================================


# --- 投递名册 ---------------------------------------------------------
class DeliveryCreateIn(BaseModel):
    year: int = Field(ge=2000, le=2100)
    delivery_no: str = Field(min_length=1)
    recipient_name: str = Field(min_length=1)
    recipient_address: str = Field(min_length=1)
    recipient_phone: Optional[str] = None
    recipient_province: Optional[str] = None
    recipient_city: Optional[str] = None
    recipient_district: Optional[str] = None
    recipient_postal_code: Optional[str] = None
    external_order_no: Optional[str] = None
    product: Optional[str] = None
    copies: int = 1
    amount: Optional[Decimal] = None
    coverage_start_date: Optional[date] = None
    coverage_end_date: Optional[date] = None
    source_channel: Optional[str] = None
    distribution_unit_id: Optional[int] = None
    salesperson: Optional[str] = None
    remittance_name: Optional[str] = None
    remittance_date: Optional[date] = None
    notes: Optional[str] = None


class DeliveryUpdateIn(BaseModel):
    year: Optional[int] = Field(default=None, ge=2000, le=2100)
    delivery_no: Optional[str] = None
    recipient_name: Optional[str] = None
    recipient_address: Optional[str] = None
    recipient_phone: Optional[str] = None
    recipient_province: Optional[str] = None
    recipient_city: Optional[str] = None
    recipient_district: Optional[str] = None
    recipient_postal_code: Optional[str] = None
    external_order_no: Optional[str] = None
    product: Optional[str] = None
    copies: Optional[int] = None
    amount: Optional[Decimal] = None
    coverage_start_date: Optional[date] = None
    coverage_end_date: Optional[date] = None
    source_channel: Optional[str] = None
    distribution_unit_id: Optional[int] = None
    salesperson: Optional[str] = None
    remittance_name: Optional[str] = None
    remittance_date: Optional[date] = None
    notes: Optional[str] = None


# --- 投诉工单 + 处理流程 ---------------------------------------------
class ComplaintCreateIn(BaseModel):
    year: Optional[int] = Field(default=None, ge=2000, le=2100)
    delivery_no: Optional[str] = None          # 与 year 一起关联投递记录（去零编号）
    complaint_date: Optional[date] = None
    missing_issues: Optional[str] = None       # 投诉情况
    handling: Optional[str] = None             # 处理情况（原文，服务端归一出 routed_label）
    routed_unit_id: Optional[int] = None       # 投递渠道单位
    first_handler: Optional[str] = None
    snap_name: Optional[str] = None
    snap_phone: Optional[str] = None
    snap_address: Optional[str] = None
    snap_postal_code: Optional[str] = None
    status: Optional[PostalComplaintStatus] = None  # 缺省 open
    notes: Optional[str] = None


class ComplaintUpdateIn(BaseModel):
    year: Optional[int] = Field(default=None, ge=2000, le=2100)
    delivery_no: Optional[str] = None
    complaint_date: Optional[date] = None
    missing_issues: Optional[str] = None
    handling: Optional[str] = None
    routed_unit_id: Optional[int] = None
    first_handler: Optional[str] = None
    follow_up: Optional[str] = None
    snap_name: Optional[str] = None
    snap_phone: Optional[str] = None
    snap_address: Optional[str] = None
    snap_postal_code: Optional[str] = None
    status: Optional[PostalComplaintStatus] = None
    notes: Optional[str] = None


class HandlingCreateIn(BaseModel):
    action: str = Field(min_length=1)                       # 处理过程 / 动作（必填）
    follow_result: Optional[str] = None                     # 回访结果
    result_status: Optional[PostalComplaintStatus] = None   # 本次处理后状态（缺省 in_progress）


class HandlingRecordOut(BaseModel):
    id: int
    complaint_id: int
    handled_at: Optional[datetime] = None
    handled_by: Optional[int] = None
    handled_by_name: Optional[str] = None
    action: str
    follow_result: Optional[str] = None
    result_status: Optional[str] = None

    model_config = {"from_attributes": True}


class ComplaintDetailOut(BaseModel):
    complaint: ComplaintOut
    handlings: List[HandlingRecordOut]


# --- 改地址工单 -------------------------------------------------------
class AddressChangeCreateIn(BaseModel):
    year: Optional[int] = Field(default=None, ge=2000, le=2100)
    delivery_no: Optional[str] = None          # 与 year 一起关联投递记录
    change_date: Optional[date] = None
    old_name: Optional[str] = None
    old_phone: Optional[str] = None
    old_address: Optional[str] = None
    old_copies: Optional[int] = None
    new_name: Optional[str] = None
    new_phone: Optional[str] = None
    new_address: Optional[str] = None
    new_copies: Optional[int] = None
    original_start_month: Optional[str] = None
    effective_start_month: Optional[str] = None
    handling: Optional[str] = None
    notes: Optional[str] = None


class AddressChangeUpdateIn(BaseModel):
    year: Optional[int] = Field(default=None, ge=2000, le=2100)
    delivery_no: Optional[str] = None
    change_date: Optional[date] = None
    old_name: Optional[str] = None
    old_phone: Optional[str] = None
    old_address: Optional[str] = None
    old_copies: Optional[int] = None
    new_name: Optional[str] = None
    new_phone: Optional[str] = None
    new_address: Optional[str] = None
    new_copies: Optional[int] = None
    original_start_month: Optional[str] = None
    effective_start_month: Optional[str] = None
    handling: Optional[str] = None
    notes: Optional[str] = None


# --- 回访 -------------------------------------------------------------
class FollowUpCreateIn(BaseModel):
    year: Optional[int] = Field(default=None, ge=2000, le=2100)
    delivery_no: Optional[str] = None          # 与 year 一起关联投递记录
    follow_up_date: Optional[date] = None
    batch_label: Optional[str] = None
    result: Optional[str] = None
    snap_name: Optional[str] = None


class FollowUpUpdateIn(BaseModel):
    year: Optional[int] = Field(default=None, ge=2000, le=2100)
    delivery_no: Optional[str] = None
    follow_up_date: Optional[date] = None
    batch_label: Optional[str] = None
    result: Optional[str] = None
    snap_name: Optional[str] = None


# --- 收款 / 发票 ------------------------------------------------------
class FinanceCreateIn(BaseModel):
    external_order_no: Optional[str] = None    # 原始平台订单号（优先挂单）
    payer_name: Optional[str] = None           # 付款人姓名（兜底挂单）
    product: Optional[str] = None
    copies: Optional[int] = None
    amount: Optional[Decimal] = None
    fee_amount: Optional[Decimal] = None
    net_amount: Optional[Decimal] = None       # 空则服务端按 金额-手续费 派生
    collected_at: Optional[date] = None
    invoiced_amount: Optional[Decimal] = None
    buyer_title: Optional[str] = None
    tax_no: Optional[str] = None
    invoice_recipient: Optional[str] = None
    tax_category: Optional[str] = None
    platform: Optional[str] = None
    notes: Optional[str] = None


class FinanceUpdateIn(BaseModel):
    external_order_no: Optional[str] = None
    payer_name: Optional[str] = None
    product: Optional[str] = None
    copies: Optional[int] = None
    amount: Optional[Decimal] = None
    fee_amount: Optional[Decimal] = None
    net_amount: Optional[Decimal] = None
    collected_at: Optional[date] = None
    invoiced_amount: Optional[Decimal] = None
    buyer_title: Optional[str] = None
    tax_no: Optional[str] = None
    invoice_recipient: Optional[str] = None
    tax_category: Optional[str] = None
    platform: Optional[str] = None
    notes: Optional[str] = None
