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
from app.models.order import (
    OrderCommercialStatus,
    OrderEntryMethod,
    OrderPaymentMethod,
    OrderStatus,
)
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
    # 投递单位（邮局各地集订分送 → partners.id）；仅 post_office 目标使用，无则留空。
    distribution_unit_id: Optional[int] = None
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
    # 原价（折前）；电商导入按行写入，手工单可空。用于按活动统计折扣深度。
    original_amount: Optional[Decimal] = None
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


class RefundIn(BaseModel):
    """Payload for POST /orders/{id}/refund — one refund line (full or partial).

    The two optional scope knobs cover all three partial-refund shapes:
    * both NULL                       → money-only, delivery unchanged
    * ``order_item_id`` set           → that item is the one refunded
    * ``stop_from_issue`` set         → stop delivery from that issue onward
    """

    amount: Decimal = Field(gt=0)
    reason: Optional[str] = Field(default=None, max_length=500)
    order_item_id: Optional[int] = None
    stop_from_issue: Optional[int] = Field(default=None, ge=1)
    # 退款业务日期；省略则服务端取记账当天。
    refunded_at: Optional[date] = None


class OrderCancelIn(BaseModel):
    """Payload for POST /orders/{id}/cancel.

    Cancelling also records a full refund of the outstanding paid amount
    (实付 − 已退) and stops all delivery.
    """

    reason: str = Field(min_length=1, max_length=255)


class PaymentIn(BaseModel):
    """Payload for POST /orders/{id}/payments — 记一笔收款（到账）。"""

    amount: Decimal = Field(gt=0)
    method: Optional[str] = Field(default=None, max_length=32)
    collected_at: Optional[date] = None  # 省略则取记账当天
    notes: Optional[str] = Field(default=None, max_length=500)


class BulkConfirmIn(BaseModel):
    """Payload for POST /orders/bulk-confirm."""

    order_ids: List[int] = Field(min_length=1)


class BulkVoidIn(BaseModel):
    """Payload for POST /orders/bulk-void (one shared reason for all)."""

    order_ids: List[int] = Field(min_length=1)
    reason: str = Field(min_length=1, max_length=255)


class BulkDeleteIn(BaseModel):
    """Payload for POST /orders/bulk-delete (hard delete, admin only)."""

    order_ids: List[int] = Field(min_length=1)


class BulkOpFailure(BaseModel):
    order_id: int
    detail: str


class BulkOpResult(BaseModel):
    succeeded: List[int]
    failed: List[BulkOpFailure]


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
    distribution_unit_id: Optional[int] = None
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
    # 已发数：关联到本明细且 shipped_at 非空的发货明细行数。缺口 = synced_count − shipped_count。
    shipped_count: int = 0
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


class RefundOut(BaseModel):
    id: int
    order_item_id: Optional[int]
    amount: Decimal
    reason: Optional[str]
    stop_from_issue: Optional[int]
    refunded_at: date
    operator_id: Optional[int]
    created_at: datetime

    model_config = {"from_attributes": True}


class PaymentOut(BaseModel):
    id: int
    amount: Decimal
    method: Optional[str]
    collected_at: date
    notes: Optional[str]
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
    commercial_status: Optional[OrderCommercialStatus] = None
    refunded_amount: Decimal = Decimal("0")
    # 欠款 = max(0, 应收 total_amount − 实付 paid_amount)
    outstanding_amount: Decimal = Decimal("0")
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime
    items: List[OrderItemOut]
    refunds: List[RefundOut] = Field(default_factory=list)
    payments: List[PaymentOut] = Field(default_factory=list)

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
    paid_amount: Decimal = Decimal("0")
    outstanding_amount: Decimal = Decimal("0")
    coverage_start_date: Optional[date]
    coverage_end_date: Optional[date]
    status: OrderStatus
    commercial_status: Optional[OrderCommercialStatus] = None
    refunded_amount: Decimal = Decimal("0")
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


# --- Batch shipping sync (某期一键排发 / 漏期报表 / 本单全部期) ---------------


class IssueGapRow(BaseModel):
    """One (order, recipient) candidate's status for an issue's gap report."""

    order_id: int
    order_code: Optional[str] = None
    order_item_id: Optional[int] = None
    fulfillment_target_id: Optional[int] = None
    recipient_name: Optional[str] = None
    quantity: Optional[int] = None
    reason: Optional[str] = None


class IssueGapReport(BaseModel):
    """某期「谁该排却没排」报表。``missing`` 待排、``stale`` 已建但字段有变化、
    ``conflict`` 人工改过待核、``skipped`` 因覆盖期缺失/休刊/缺收件人等跳过。
    ``synced_count`` 为已同步且无变化的收件人数。"""

    issue_number: int
    publish_date: date
    suspended: bool = False
    total_orders: int = 0
    synced_count: int = 0
    missing: list[IssueGapRow] = Field(default_factory=list)
    stale: list[IssueGapRow] = Field(default_factory=list)
    conflict: list[IssueGapRow] = Field(default_factory=list)
    skipped: list[IssueGapRow] = Field(default_factory=list)


class BatchSyncConflict(BaseModel):
    order_id: int
    order_code: Optional[str] = None
    conflict_count: int


class BatchSyncSummary(BaseModel):
    """某期批量排发结果。冲突单不中断整批、计入 ``conflicts`` 供人工核对。"""

    issue_number: int
    suspended: bool = False
    orders_total: int = 0
    orders_applied: int = 0
    orders_unchanged: int = 0
    orders_skipped: int = 0
    orders_conflict: int = 0
    rows_created: int = 0
    rows_updated: int = 0
    conflicts: list[BatchSyncConflict] = Field(default_factory=list)
    skipped_reasons: dict[str, int] = Field(default_factory=dict)
    message: Optional[str] = None


class OrderAllIssuesSyncSummary(BaseModel):
    """单订单「同步全部生效期」结果。``issues_no_calendar`` 为覆盖期推出、但
    ``issues`` 表里还没有的期（无法同步，提示先建刊期）。"""

    order_id: int
    issues_total: int = 0
    issues_synced: int = 0
    rows_created: int = 0
    rows_updated: int = 0
    conflict_issues: list[int] = Field(default_factory=list)
    issues_no_calendar: list[int] = Field(default_factory=list)


# --- 已发货回写 + 应发vs实发对账 ---


class IssueShipAllIn(BaseModel):
    """Payload for POST …/issues/{n}/ship-all — 按期一键标已发。"""

    # 省略则取记账当天。只标本期已生成且未发的行，实发份数默认 = 计划 quantity。
    shipped_at: Optional[date] = None


class ShipBatchResult(BaseModel):
    issue_number: int
    shipped_rows: int = 0
    shipped_at: Optional[date] = None


class ReconUnshippedRow(BaseModel):
    order_id: Optional[int] = None
    order_code: Optional[str] = None
    shipping_detail_id: int
    recipient_name: Optional[str] = None
    quantity: Optional[int] = None


class IssueReconciliation(BaseModel):
    """某期「应发 vs 实发」对账。应发=Σ已生成行计划份数；已发=Σ实发份数(标已发的行，
    实发缺省按计划计)；缺口=应发−已发；``unshipped`` 为已排但未发的行清单。"""

    issue_number: int
    publish_date: date
    planned_rows: int = 0
    planned_quantity: int = 0
    shipped_rows: int = 0
    shipped_quantity: int = 0
    shortfall_quantity: int = 0
    unshipped: list[ReconUnshippedRow] = Field(default_factory=list)
