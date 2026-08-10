from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


ChannelCode = Literal["postal", "retail", "guangzhou", "chengdu"]
DocumentType = Literal["weekly", "monthly", "adjustment"]
ItemKind = Literal["base", "adjustment"]
SourceStatus = Literal["pending_review", "channel_pending", "confirmed"]
AdjustmentKind = Literal["archive_only", "billable_addition", "replacement", "reduction"]
SourceAction = Literal[
    "base",
    "prepress_addition",
    "postpress_addition",
    "damage_reshipment",
    "reduction",
    "archive_only",
]
AppliedPhase = Literal["pre_confirmation", "post_confirmation"]
EffectStatus = Literal["active", "replaced"]


class SourceSuggestion(BaseModel):
    issue_number: Optional[int] = None
    source_period: Optional[str] = None
    item_kind: ItemKind = "base"
    category: ChannelCode
    sub_category: str
    source_label: Optional[str] = None
    source_quantity: Optional[int] = None
    applied_quantity: Optional[int] = None
    source_status: SourceStatus = "pending_review"
    adjustment_kind: Optional[AdjustmentKind] = None
    source_action: SourceAction = "base"
    supersedes_item_id: Optional[int] = None
    confidence: Optional[float] = Field(default=None, ge=0, le=1)
    notes: Optional[str] = None


class ReportSourceItemConfirmIn(BaseModel):
    issue_number: int
    item_kind: ItemKind = "base"
    category: ChannelCode
    sub_category: str
    source_label: Optional[str] = None
    source_quantity: Optional[int] = None
    applied_quantity: Optional[int] = None
    source_status: SourceStatus = "confirmed"
    adjustment_kind: Optional[AdjustmentKind] = None
    source_action: SourceAction = "base"
    supersedes_item_id: Optional[int] = None
    notes: Optional[str] = None


class ReportSourceConfirmIn(BaseModel):
    items: list[ReportSourceItemConfirmIn] = Field(min_length=1)
    apply_base_values: bool = True


class ReportSourceItemOut(BaseModel):
    id: int
    document_id: int
    issue_number: int
    item_kind: str
    category: str
    sub_category: str
    source_label: Optional[str] = None
    source_quantity: Optional[int] = None
    applied_quantity: Optional[int] = None
    source_status: str
    source_action: str
    applied_phase: str
    print_delta: int
    effect_status: str
    supersedes_item_id: Optional[int] = None
    adjustment_kind: Optional[str] = None
    settlement_delta: int
    shipping_delta: int
    shipped_quantity: int
    tracking_no: Optional[str] = None
    shipped_at: Optional[datetime] = None
    notes: Optional[str] = None
    confirmed_at: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ReportSourceDocumentOut(BaseModel):
    id: int
    channel: str
    document_type: str
    original_filename: str
    display_name: str
    mime_type: Optional[str] = None
    size: int
    sha256: str
    source_date: Optional[date] = None
    extraction_status: str
    extraction_json: Optional[dict] = None
    uploaded_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    items: list[ReportSourceItemOut] = Field(default_factory=list)


class ReportSourceUploadOut(ReportSourceDocumentOut):
    suggestions: list[SourceSuggestion] = Field(default_factory=list)
    duplicate: bool = False


class ChannelSourceSummary(BaseModel):
    channel: str
    document_count: int = 0
    base_quantity: int = 0
    source_total: int = 0
    source_difference: int = 0
    active_source_count: int = 0
    settlement_delta: int = 0
    settlement_total: int = 0
    shipping_delta: int = 0
    shipped_quantity: int = 0
    pending_shipping: int = 0
    pending_count: int = 0


class IssueSourceSummaryOut(BaseModel):
    issue_number: int
    document_count: int
    documents: list[ReportSourceDocumentOut]
    channels: list[ChannelSourceSummary]
