"""来源交易查询与确认请求。"""
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from pydantic import BaseModel, ConfigDict, Field


class SourceLinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    order_id: int
    order_item_id: int | None
    target_id: int | None
    amount: Decimal
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
    amount: Decimal = Field(gt=0, max_digits=10, decimal_places=2)


class SourceLinkIn(SourceRevisionIn):
    allocations: list[SourceAllocationIn] = Field(max_length=100)


class SourceRefundIn(SourceRevisionIn):
    amount: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    refunded_at: date | None = None


class SourceDeliveryIn(SourceRevisionIn):
    link_id: int
    effective_from_issue: int = Field(gt=0)
