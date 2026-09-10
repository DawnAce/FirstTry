"""来源交易查询与确认请求。"""
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field


class SourceLinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    order_id: int
    order_item_id: int | None
    target_id: int | None
    amount: Decimal
    refund_amount: Decimal | None = None
    active: int
    delivery_from_issue: int | None
    reason: str


class SourceOut(BaseModel):
    id: int
    platform: str
    store: str
    external_order_no: str
    kind: str
    revision: int
    version: int
    order_date: date | None
    commercial_status: str | None
    paid_amount: Decimal
    verified_refund_amount: Decimal | None
    verified_refund_date: date | None
    finance_note: str | None
    snapshot: dict[str, Any]
    links: list[SourceLinkOut]
    allocation_valid: bool = True
    refund_pending: bool = False
    net_amount: Decimal | None = None
    events: list[dict[str, Any]] = Field(default_factory=list)
    delivery_changes: list[dict[str, Any]] = Field(default_factory=list)
    versions: list[dict[str, Any]] = Field(default_factory=list)


class SourceListOut(BaseModel):
    rows: list[SourceOut]
    total: int


class SourceRevisionIn(BaseModel):
    version: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=1000)


class SourceAllocationIn(BaseModel):
    order_id: int
    order_item_id: int
    target_id: int
    amount: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    expected_target_version: str = Field(min_length=64, max_length=64)


class SourceLinkIn(SourceRevisionIn):
    allocations: list[SourceAllocationIn] = Field(max_length=100)


class SourceRefundAllocationIn(BaseModel):
    link_id: int
    amount: Decimal = Field(ge=0, max_digits=10, decimal_places=2)


class SourceRefundIn(SourceRevisionIn):
    amount: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    refunded_at: date | None = None
    allocations: list[SourceRefundAllocationIn] = Field(default_factory=list, max_length=100)


class SourceDeliveryIn(SourceRevisionIn):
    link_id: int
    effective_from_issue: int = Field(gt=0)
    shipping_channel: Literal["zto_outsource", "post_office"] = "zto_outsource"
    postal_delivery_ids: list[int] = Field(default_factory=list, max_length=100)
    postal_confirmed: bool = False
    expected_state: str | None = Field(default=None, min_length=64, max_length=64)


class SourceDeliveryUndoIn(SourceRevisionIn):
    change_id: int
    expected_state: str | None = Field(default=None, min_length=64, max_length=64)


class SourceCandidateOut(BaseModel):
    order_id: int
    order_code: str | None
    external_order_no: str | None
    order_date: date
    order_item_id: int
    target_id: int
    publication: str
    recipient_name: str
    recipient_phone: str | None
    recipient_address: str
    coverage_start_date: date | None
    coverage_end_date: date | None
    confidence: str
    evidence: list[str]
    expected_target_version: str


class SourceCandidatesOut(BaseModel):
    rows: list[SourceCandidateOut]
    truncated: bool


class SourceLinkPreviewOut(BaseModel):
    can_apply: bool
    total_amount: Decimal
    allocations: list[SourceAllocationIn]
    warnings: list[str]


class SourceFinanceSummaryOut(BaseModel):
    fee_count: int
    fee_paid_amount: Decimal
    fee_refunded_amount: Decimal
    fee_net_amount: Decimal | None
    unresolved_count: int
    subscription_paid_amount: Decimal | None = None
    subscription_refunded_amount: Decimal | None = None
    combined_net_amount: Decimal | None = None


class SourceDeliveryPreviewOut(BaseModel):
    expected_state: str
    effective_date: date
    postal_until_date: date
    order_id: int
    target_id: int
    recipient_name: str
    from_channel: str
    to_channel: str
    postal_records: list[dict[str, Any]] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
