"""Pydantic schemas for the order management module (V1.1).

Layered by purpose:

* ``*In``     — payloads accepted from the frontend when creating or
                editing an order.
* ``*Out``    — payloads returned to the frontend; almost all of them
                set ``model_config = {"from_attributes": True}`` so they
                can be built directly from SQLAlchemy ORM instances.
* ``OrderListRow`` is *not* directly from ORM — the service layer
  assembles each row by joining order + item aggregates + drift
  computation, so it has plain ``BaseModel`` semantics.

V2 fields (e.g. ``OrderCreate.import_batch_id``) are intentionally
omitted: V1.1 is manual single-entry only.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.models.fulfillment_target import ShippingChannel, TargetStatus
from app.models.order import OrderEntryMethod, OrderPaymentMethod, OrderStatus
from app.models.order_event import OrderEventType
from app.models.order_item import (
    BillingType,
    DeliveryMethod,
    FulfillmentType,
    OrderItemStatus,
    Publication,
    PublicationFormat,
    SubscriptionTerm,
)


# =============================================================================
# Inputs (from frontend)
# =============================================================================


class FulfillmentTargetIn(BaseModel):
    """One recipient row in the order editor.

    Quantity semantics: ``quantity`` is the number of copies the recipient
    receives **per issue** (typically 1 for a subscription). The sum of all
    targets' ``quantity`` must equal the parent ``OrderItemIn.total_quantity``.
    """

    recipient_name: str = Field(min_length=1, max_length=128)
    recipient_phone: Optional[str] = Field(default=None, max_length=64)
    recipient_address: str = Field(min_length=1)
    recipient_postal_code: Optional[str] = Field(default=None, max_length=20)
    quantity: int = Field(default=1, ge=1)
    shipping_channel: ShippingChannel = ShippingChannel.zto_outsource
    effective_from_issue: Optional[int] = Field(default=None, ge=1)
    effective_until_issue: Optional[int] = Field(default=None, ge=1)
    notes: Optional[str] = None

    @model_validator(mode="after")
    def _check_issue_range(self) -> "FulfillmentTargetIn":
        if (
            self.effective_from_issue is not None
            and self.effective_until_issue is not None
            and self.effective_until_issue < self.effective_from_issue
        ):
            raise ValueError(
                "effective_until_issue must be >= effective_from_issue"
            )
        return self


class OrderItemIn(BaseModel):
    """One sellable line inside an order, with its initial recipient split.

    Quantity / price semantics (see docs/technical.md §3.15):

    - ``total_quantity``: copies shipped **per issue** (NOT total across the
      coverage period). For subscriptions this equals the number of
      subscribers (× per-subscriber copies if > 1). Must equal the sum of
      the line's target quantities.
    - ``unit_price``: price per "copy slot". For subscriptions, this is the
      single-subscriber price for the **entire coverage period** (e.g. ¥120
      for a 6-month sub); for single-issue / retail orders it's the per-copy
      retail price (e.g. ¥5).
    - ``subtotal``: ``total_quantity * unit_price`` (the formula does NOT
      multiply by issue count — the per-period unit_price already accounts
      for that on the subscription side).
    - Actual print volume = ``total_quantity * expected_issues_at_creation``
      (computed at confirm time, shown on the detail page progress card).
    """

    publication: Publication = Publication.cbj
    publication_format: PublicationFormat = PublicationFormat.paper
    fulfillment_type: FulfillmentType
    billing_type: BillingType = BillingType.paid
    subscription_term: Optional[SubscriptionTerm] = None
    delivery_method: Optional[DeliveryMethod] = None
    term_start_month: Optional[str] = Field(
        default=None,
        pattern=r"^\d{4}-(0[1-9]|1[0-2])$",
    )
    coverage_start_date: Optional[date] = None
    coverage_end_date: Optional[date] = None
    issue_number: Optional[int] = Field(default=None, ge=1)
    # 单期身份标签（商学院月刊等无连续期号的刊物）：规范化 "YYYY-MM" / "YYYY-MM~MM"，
    # 供按期统计。年/月落在这里（期次层），不进商品名。
    issue_label: Optional[str] = Field(default=None, max_length=32)
    total_quantity: int = Field(default=1, ge=1)
    unit_price: Decimal = Decimal("0")
    subtotal: Decimal = Decimal("0")
    notes: Optional[str] = None
    targets: List[FulfillmentTargetIn] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_coverage_dates(self) -> "OrderItemIn":
        if (
            self.coverage_start_date is not None
            and self.coverage_end_date is not None
            and self.coverage_end_date < self.coverage_start_date
        ):
            raise ValueError(
                "coverage_end_date must be >= coverage_start_date"
            )
        return self

    @model_validator(mode="after")
    def _check_targets_sum(self) -> "OrderItemIn":
        # Only enforce when targets are provided; an item can be saved
        # as draft with no recipients yet (operator fills them in later).
        if self.targets:
            total = sum(t.quantity for t in self.targets)
            if total != self.total_quantity:
                raise ValueError(
                    f"sum of target quantities ({total}) must equal "
                    f"total_quantity ({self.total_quantity})"
                )
        return self


class OrderCreate(BaseModel):
    """Payload for POST /orders (draft or pending_confirmation)."""

    external_order_no: Optional[str] = Field(default=None, max_length=128)
    order_date: date
    # 录入方式 provenance；前端不暴露选择 UI。默认 `manual`，服务端的手工
    # 录入入口固定写 manual（不信任客户端传值）；Excel 批量导入 / API 同步
    # 入口分别固定写 `excel_import` / `api_sync`。
    # 销售渠道信息（电商平台、店铺）走 source_platform / source_store。
    entry_method: OrderEntryMethod = OrderEntryMethod.manual
    source_platform: Optional[str] = Field(default=None, max_length=64)
    source_store: Optional[str] = Field(default=None, max_length=128)
    # 营销活动标签（如 "2026-618"）；电商导入按批次写入，手工单留空。
    campaign: Optional[str] = Field(default=None, max_length=64)
    payer_name: str = Field(min_length=1, max_length=128)
    payer_contact: Optional[str] = Field(default=None, max_length=64)
    payment_method: Optional[OrderPaymentMethod] = None
    payment_collector: Optional[str] = Field(default=None, max_length=64)
    total_amount: Decimal = Decimal("0")
    paid_amount: Decimal = Decimal("0")
    invoice_required: bool = False
    invoice_title: Optional[str] = Field(default=None, max_length=200)
    # 纳税人识别号 / 统一社会信用代码（USCC 18 位字母数字）；个人发票可留空
    invoice_tax_no: Optional[str] = Field(default=None, max_length=64)
    # 电子发票送达邮箱；前端 Form 已做格式校验，后端只做长度限制 + 可空
    invoice_recipient_email: Optional[str] = Field(default=None, max_length=128)
    notes: Optional[str] = None
    items: List[OrderItemIn] = Field(min_length=1)


class OrderUpdate(BaseModel):
    """Payload for PUT /orders/{id}.

    All fields optional — only those set in the request body are applied.
    Business rules (enforced in the service layer, not here):

    * Draft orders: any field can be patched.
    * Active orders: only ``ACTIVE_EDITABLE_FIELDS`` may be patched;
      structural fields (``order_date`` / ``payer_name``) are rejected
      with HTTP 422 — those require the V1.2 version-switching flow.
    * Voided orders: rejected with HTTP 409.

    ``entry_method`` is **not** included here. It is provenance metadata
    (how the order entered the system) and must not be mutated through
    a normal edit. Excel import / API sync flows set it via dedicated
    creation paths.

    Items / targets edits are out of scope here; they will get dedicated
    endpoints in V1.2.
    """

    order_date: Optional[date] = None
    source_platform: Optional[str] = Field(default=None, max_length=64)
    source_store: Optional[str] = Field(default=None, max_length=128)
    external_order_no: Optional[str] = Field(default=None, max_length=128)
    payer_name: Optional[str] = Field(default=None, max_length=128)
    payer_contact: Optional[str] = Field(default=None, max_length=64)
    payment_method: Optional[OrderPaymentMethod] = None
    payment_collector: Optional[str] = Field(default=None, max_length=64)
    total_amount: Optional[Decimal] = None
    paid_amount: Optional[Decimal] = None
    invoice_required: Optional[bool] = None
    invoice_title: Optional[str] = Field(default=None, max_length=200)
    invoice_tax_no: Optional[str] = Field(default=None, max_length=64)
    invoice_recipient_email: Optional[str] = Field(default=None, max_length=128)
    notes: Optional[str] = None


class OrderVoidIn(BaseModel):
    """Payload for POST /orders/{id}/void."""

    reason: str = Field(min_length=1, max_length=255)


class OrderItemUpdate(OrderItemIn):
    """Extension of OrderItemIn that optionally carries a DB id for matching.

    Items with an ``id`` are matched to existing records (update/keep).
    Items without ``id`` are treated as new additions.
    Existing items not present in the list are treated as removals.
    """

    id: Optional[int] = None


class OrderItemsUpdate(BaseModel):
    """Payload for PUT /orders/{id}/items — batch update items on an active order."""

    effective_from_issue: int = Field(ge=1, description="新版本生效起始期号")
    change_reason: Optional[str] = Field(default=None, max_length=255)
    items: List[OrderItemUpdate] = Field(min_length=1)


class PricingPreviewIn(BaseModel):
    subscription_term: SubscriptionTerm
    delivery_method: DeliveryMethod
    term_start_month: str = Field(pattern=r"^\d{4}-\d{2}$")
    total_quantity: int = Field(default=1, ge=1)


class PricingPreviewOut(BaseModel):
    month_range_label: str
    coverage_start_date: date
    coverage_end_date: date
    expected_issue_count: int
    unit_price: Decimal
    subtotal: Decimal
    price_label: str
    schedule_incomplete: bool = False
    warning: Optional[str] = None


# =============================================================================
# Outputs (to frontend)
# =============================================================================


class FulfillmentTargetOut(BaseModel):
    id: int
    recipient_name: str
    recipient_phone: Optional[str]
    recipient_address: str
    recipient_postal_code: Optional[str]
    quantity: int
    shipping_channel: ShippingChannel
    effective_from_issue: Optional[int]
    effective_until_issue: Optional[int]
    status: TargetStatus
    notes: Optional[str]

    model_config = {"from_attributes": True}


class FulfillmentAllocationOut(BaseModel):
    id: int
    version_no: int
    effective_from_issue: Optional[int]
    effective_until_issue: Optional[int]
    change_reason: Optional[str]
    created_at: datetime
    targets: List[FulfillmentTargetOut]

    model_config = {"from_attributes": True}


class FulfillmentProgress(BaseModel):
    """Per-item fulfillment progress summary computed by the service layer.

    For V1.1 ``synced_count`` is always 0 (sync feature lands in V1.3),
    but the schema is stable so the frontend doesn't have to change.
    """

    expected_at_creation: Optional[int]
    current_expected: Optional[int]
    drift: Optional[int]
    synced_count: int
    skipped_count: int


class OrderItemOut(BaseModel):
    id: int
    publication: Publication
    publication_format: PublicationFormat
    fulfillment_type: FulfillmentType
    billing_type: BillingType
    subscription_term: Optional[SubscriptionTerm] = None
    delivery_method: Optional[DeliveryMethod] = None
    term_start_month: Optional[str] = None
    coverage_start_date: Optional[date]
    coverage_end_date: Optional[date]
    issue_number: Optional[int]
    issue_label: Optional[str] = None
    total_quantity: int
    unit_price: Decimal
    subtotal: Decimal
    expected_issues_at_creation: Optional[int]
    status: OrderItemStatus
    notes: Optional[str]
    allocations: List[FulfillmentAllocationOut]
    progress: FulfillmentProgress

    model_config = {"from_attributes": True}


class OrderEventOut(BaseModel):
    id: int
    event_type: OrderEventType
    payload_json: Optional[dict]
    operator_id: Optional[int]
    created_at: datetime

    model_config = {"from_attributes": True}


class OrderOut(BaseModel):
    id: int
    order_code: Optional[str]
    external_order_no: Optional[str]
    order_date: date
    entry_method: OrderEntryMethod
    source_platform: Optional[str]
    source_store: Optional[str]
    campaign: Optional[str]
    payer_name: str
    payer_contact: Optional[str]
    payment_method: Optional[OrderPaymentMethod]
    payment_collector: Optional[str]
    total_amount: Decimal
    paid_amount: Decimal
    invoice_required: bool
    invoice_title: Optional[str]
    invoice_tax_no: Optional[str]
    invoice_recipient_email: Optional[str]
    status: OrderStatus
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime
    items: List[OrderItemOut]

    model_config = {"from_attributes": True}


class OrderListRow(BaseModel):
    """One row for the order list page.

    Assembled by the service layer — not directly built from an ORM
    instance — because it aggregates across items (``total_quantity``,
    ``coverage_*``) and computes drift.
    """

    id: int
    order_code: Optional[str]
    external_order_no: Optional[str]
    order_date: date
    payer_name: str
    entry_method: OrderEntryMethod
    source_platform: Optional[str]
    campaign: Optional[str] = None
    total_quantity: int
    total_amount: Decimal
    coverage_start_date: Optional[date]
    coverage_end_date: Optional[date]
    status: OrderStatus
    has_drift: bool
    synced_count: int
    expected_total: Optional[int]


class OrderShippingSyncApplyIn(BaseModel):
    issue_number: int


class OrderShippingSyncSummary(BaseModel):
    candidates: int = 0
    to_create: int = 0
    to_update: int = 0
    skipped: int = 0
    conflicts: int = 0


class OrderShippingSyncItem(BaseModel):
    action: str
    order_id: int
    order_item_id: int | None = None
    fulfillment_target_id: int | None = None
    shipping_detail_id: int | None = None
    name: str | None = None
    quantity: int | None = None
    reason: str | None = None
    diff: dict | None = None


class OrderShippingSyncPreview(BaseModel):
    order_id: int
    issue_number: int
    summary: OrderShippingSyncSummary
    items: list[OrderShippingSyncItem]
    message: str | None = None
