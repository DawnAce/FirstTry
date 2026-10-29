from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class DemandLineIn(BaseModel):
    issue_number: int = Field(gt=0)
    sub_category: str = Field(min_length=1, max_length=100)
    quantity: int | None = Field(default=None, ge=0, le=10_000_000, strict=True)
    review_status: Literal["confirmed", "pending", "none"] = "pending"

    @model_validator(mode="after")
    def validate_quantity(self):
        if self.review_status == "confirmed" and self.quantity is None:
            raise ValueError("已确认明细必须填写数量；待定不能当作零")
        if self.review_status == "none" and self.quantity not in (None, 0):
            raise ValueError("明确不订的数量必须为零或空")
        return self


class DemandIn(BaseModel):
    partner_id: int = Field(gt=0)
    contract_id: int | None = None
    category: str = Field(min_length=1, max_length=50)
    document_type: Literal["order", "report"] = "order"
    cycle: Literal["month", "week", "biweek", "custom", "fixed"] = "month"
    received_date: date
    transport: Literal["zto", "channel", "pending"] = "pending"
    recipient_name: str | None = Field(default=None, max_length=128)
    recipient_phone: str | None = Field(default=None, max_length=64)
    recipient_address: str | None = Field(default=None, max_length=500)
    pricing_mode: Literal["unpriced", "chengdu_annual"] = "unpriced"
    notes: str | None = Field(default=None, max_length=2000)
    lines: list[DemandLineIn] = Field(min_length=1, max_length=500)
    version: int = Field(default=1, ge=1)


class DemandVersionIn(BaseModel):
    version: int = Field(ge=1)
    reviewed: bool = False


class DemandLineOut(DemandLineIn):
    id: int
    publish_date: date
    unit_price: Decimal | None
    model_config = {"from_attributes": True}


class DemandAttachmentOut(BaseModel):
    id: int
    filename: str
    extraction: dict | None
    reviewed_version: int | None
    model_config = {"from_attributes": True}


class DemandOut(BaseModel):
    id: int
    partner_id: int
    partner_name: str
    display_name: str
    contract_id: int | None
    category: str
    document_type: str
    cycle: str
    received_date: date
    status: str
    version: int
    supersedes_id: int | None
    transport: str
    recipient_name: str | None
    recipient_phone: str | None
    recipient_address: str | None
    pricing: dict | None
    estimated_amount: Decimal | None
    notes: str | None
    confirmed_at: datetime | None
    lines: list[DemandLineOut]
    attachments: list[DemandAttachmentOut]


class DemandListOut(BaseModel):
    total: int
    items: list[DemandOut]


class PrintPreviewRow(BaseModel):
    category: str
    sub_category: str
    quantity: int
    current_quantity: int | None
    fingerprint: str
    adopted: bool
    sources: list[dict]
    errors: list[str]


class PrintPreviewOut(BaseModel):
    issue_number: int
    token: str
    rows: list[PrintPreviewRow]
    can_apply: bool


class PrintApplyIn(BaseModel):
    token: str = Field(min_length=64, max_length=64)


class DemandPartnerOption(BaseModel):
    id: int
    name: str
    legal_name: str
    display_name: str
    category: str | None
    cycle: Literal["month", "week", "biweek", "custom", "fixed"]
    document_type: Literal["order", "report"]
    transport: Literal["zto", "channel", "pending"]
    chengdu: bool


class DemandTemplateOption(BaseModel):
    category: str
    sub_category: str
    display_name: str


class DemandContractOption(BaseModel):
    id: int
    partner_id: int
    title: str | None


class DemandOptionsOut(BaseModel):
    partners: list[DemandPartnerOption]
    contracts: list[DemandContractOption]
    templates: list[DemandTemplateOption]


class AnnualPricingOut(BaseModel):
    year: int
    annual_price: str
    issue_count: int
    discount: str
    unit_price: str
    schedule_fingerprint: str


class DemandTraceOut(BaseModel):
    line_id: int
    issue_number: int
    sub_category: str
    issue_id: int | None
    print_status: str
    adopted_quantity: int | None
    adopted_version: int | None
    adopted_demand_id: int | None
