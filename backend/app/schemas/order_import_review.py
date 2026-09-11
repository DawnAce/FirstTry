"""导入草稿核对请求。原始付款、来源身份均不可通过此入口修改。"""
from decimal import Decimal
from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class DraftChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    external_order_no: str = Field(min_length=1, max_length=128)
    expected_version: int = Field(strict=True, ge=1)
    reason: str = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def nonempty_reason(self):
        self.reason = self.reason.strip()
        if not self.reason:
            raise ValueError("请填写核对依据")
        return self


class ImportReviewIn(DraftChange):
    kind: Literal["delivery", "status", "amount", "date", "product", "coverage"]
    item_index: int | None = Field(default=None, strict=True, ge=0)
    value: str | None = Field(default=None, max_length=128)
    amounts: list[Decimal] | None = Field(default=None, max_length=100)
    product_id: int | None = Field(default=None, strict=True, gt=0)


class ImportFeeAllocation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    draft_key: str | None = Field(default=None, max_length=180)
    order_id: int | None = Field(default=None, strict=True, gt=0)
    order_item_id: int | None = Field(default=None, strict=True, gt=0)
    target_id: int | None = Field(default=None, strict=True, gt=0)
    expected_target_version: str = Field(min_length=64, max_length=64)
    amount: Decimal = Field(ge=0, max_digits=10, decimal_places=2)

    @model_validator(mode="after")
    def one_target(self):
        existing = [self.order_id, self.order_item_id, self.target_id]
        if not ((self.draft_key and not any(existing)) or (not self.draft_key and all(existing))):
            raise ValueError("请选择已有订阅收件目标或本批订阅明细")
        return self


class ImportFeeLinksIn(DraftChange):
    allocations: list[ImportFeeAllocation] = Field(max_length=100)


class ImportReviewOut(BaseModel):
    id: str
    kind: Literal["delivery", "status", "amount", "coverage"]
    title: str
    reason: str
    status: Literal["pending", "confirmed"]
    item_index: int | None = None
    original: str | None = None
    suggested: str | None = None
    value: str | None = None


class ImportIssueReviewOut(BaseModel):
    suggested_issue_number: int | None
    suggested_publish_date: str | None
    reason: str


class ImportIssueOptionOut(BaseModel):
    issue_number: int
    publish_date: str


class ImportItemOut(BaseModel):
    publication: str | None
    fulfillment_type: str
    billing_type: str
    subscription_term: str | None
    delivery_method: str | None
    issue_label: str | None
    issue_number: int | None
    issue_review: ImportIssueReviewOut | None = None
    total_quantity: int
    unit_price: str
    subtotal: str
    coverage_start_date: str | None
    coverage_end_date: str | None


class ImportRowOut(BaseModel):
    external_order_no: str
    recipient_name: str
    paid_amount: str
    order_date: str | None
    status_raw: str
    commercial_status: str | None
    decision: Literal["import", "skip_status", "duplicate", "unresolved", "retain", "source_update"]
    reason: str | None
    status_unknown: bool
    delivery_overridden_to_zto: bool
    warnings: list[str]
    items: list[ImportItemOut]
    unresolved_product: str | None
    source_id: int | None
    source_snapshot: dict[str, Any]
    previous_snapshot: dict[str, Any] | None
    reviews: list[ImportReviewOut]
    money: dict[str, str]
    corrected: bool = False
    is_shipping_fee: bool
    fee_link_count: int


class ImportDraftOut(BaseModel):
    session_id: str
    version: int
    counts: dict[str, int]
    can_commit: bool
    pending_review_count: int
    rows: list[ImportRowOut]
    issue_review_options: list[ImportIssueOptionOut]


class ImportFeeCandidateOut(BaseModel):
    draft_key: str | None = None
    order_id: int | None
    order_item_id: int | None
    target_id: int | None
    order_code: str | None
    external_order_no: str | None
    order_date: date
    publication: str
    recipient_name: str
    recipient_phone: str | None
    recipient_address: str
    coverage_start_date: date | None
    coverage_end_date: date | None
    confidence: Literal["possible", "high"]
    evidence: list[str]
    expected_target_version: str


class ImportFeeCandidatesOut(BaseModel):
    rows: list[ImportFeeCandidateOut]
    truncated: bool
    allocations: list[ImportFeeAllocation]


class ImportFeeResultOut(BaseModel):
    id: int
    external_order_no: str
    linked: bool


class ImportCommitOut(BaseModel):
    created: int
    order_ids: list[int]
    skipped_duplicates: int
    retained_sources: int
    source_ids: list[int]
    fee_sources: list[ImportFeeResultOut]
