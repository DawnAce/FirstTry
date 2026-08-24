from datetime import date, datetime
from typing import Any, Optional

from pydantic import BaseModel, Field, computed_field


class WaybillImportRowOut(BaseModel):
    id: int
    source_sheet: str
    source_row: int
    carrier: str
    tracking_no: Optional[str]
    recipient_name: str
    phone: Optional[str]
    address: Optional[str]
    quantity: int
    no_tracking_required: bool
    raw_values: Optional[list[Any]] = None
    manual_reviewed: bool
    match_status: str
    match_reason: Optional[str]
    shipping_detail_id: Optional[int]

    model_config = {"from_attributes": True}


class WaybillImportBatchOut(BaseModel):
    id: int
    issue_id: int
    issue_number: int
    filename: str
    status: str
    expected_quantity: int
    parsed_quantity: int
    matched_quantity: int
    pending_quantity: int
    extra_quantity: int
    matched_rows: int
    unmatched_rows: int
    warning_count: int
    created_at: datetime
    confirmed_at: Optional[datetime]
    rows: list[WaybillImportRowOut] = []

    @computed_field
    @property
    def unresolved_quantity(self) -> int:
        return sum(
            max(row.quantity, 0)
            for row in self.rows
            if row.match_status not in {"matched", "ignored"}
        )

    @computed_field
    @property
    def file_gap_quantity(self) -> int:
        return max(self.expected_quantity - self.parsed_quantity, 0)

    model_config = {"from_attributes": True}


class FulfillmentSummaryOut(BaseModel):
    issue_id: int
    issue_number: int
    expected_quantity: int
    planned_quantity: int
    handled_quantity: int
    tracked_quantity: int
    no_tracking_quantity: int
    actual_shipped_quantity: int
    adjustment_quantity: int
    no_shipment_quantity: int = 0
    warehouse_stock_in_quantity: int = 0
    deferred_quantity: int = 0
    twice_monthly_deferred_quantity: int = 0
    month_end_deferred_quantity: int = 0
    unexplained_pending_quantity: int = 0
    attributed_adjustment_quantity: int
    unattributed_adjustment_quantity: int
    pending_quantity: int
    extra_quantity: int
    package_count: int
    pending_detail_count: int
    status: str
    shipment_status: str
    latest_import: Optional[WaybillImportBatchOut] = None
    adjustments: list["FulfillmentAdjustmentOut"] = Field(default_factory=list)
    deferrals: list["ShippingDeferralOut"] = Field(default_factory=list)
    gap_details: list["ShippingGapDetailOut"] = Field(default_factory=list)


class ShippingGapDetailOut(BaseModel):
    shipping_detail_id: int
    name: str
    phone: Optional[str]
    address: Optional[str]
    channel: str
    sheet_name: str
    frequency: str
    planned_quantity: int
    source_quantity: int
    deferred_quantity: int
    twice_monthly_deferred_quantity: int = 0
    month_end_deferred_quantity: int = 0
    remaining_quantity: int
    suggested_month_end: bool
    required_adjustment_type: Optional[str] = None


class ShippingDeferralOut(BaseModel):
    id: int
    issue_id: int
    issue_number: int
    shipping_detail_id: Optional[int]
    deferral_type: str
    target_issue_number: Optional[int]
    target_publish_date: Optional[date]
    consolidation_batch: Optional[str]
    quantity: int
    reason: str
    status: str
    fulfilled_package_id: Optional[int]
    detail_name_snapshot: Optional[str]
    detail_phone_snapshot: Optional[str]
    detail_address_snapshot: Optional[str]
    detail_channel_snapshot: Optional[str]
    created_by: Optional[int]
    created_at: datetime
    fulfilled_at: Optional[datetime]

    model_config = {"from_attributes": True}


class ShippingDeferralItemIn(BaseModel):
    shipping_detail_id: int
    quantity: int = Field(gt=0)


class ShippingDeferralBulkIn(BaseModel):
    deferral_type: str = Field(
        default="month_end_consolidation",
        pattern="^(twice_monthly_consolidation|month_end_consolidation)$",
    )
    reason: str = Field(min_length=1, max_length=255)
    items: list[ShippingDeferralItemIn] = Field(min_length=1)


class ConsolidatedAllocationIn(BaseModel):
    deferral_id: int


class ConsolidatedPackageIn(BaseModel):
    carrier: str = Field(min_length=1, max_length=50)
    tracking_no: str = Field(min_length=1, max_length=100)
    deferrals: list[ConsolidatedAllocationIn] = Field(min_length=1)
    shipped_at: Optional[datetime] = None


class ConsolidatedPackageOut(BaseModel):
    package_id: int
    carrier: str
    tracking_no: str
    quantity: int
    fulfilled_deferral_ids: list[int]


class ShippingPlanTransferIn(BaseModel):
    source_detail_id: int
    quantity: int = Field(gt=0)
    reason: str = Field(min_length=1, max_length=255)
    target_detail_id: Optional[int] = None
    target_name: Optional[str] = Field(default=None, max_length=100)
    target_phone: Optional[str] = Field(default=None, max_length=50)
    target_address: Optional[str] = None
    target_channel: str = Field(default="个人订阅", max_length=255)
    target_sheet_name: str = Field(default="月底-整月", max_length=50)
    target_frequency: str = Field(default="月", max_length=50)


class ShippingPlanTransferOut(BaseModel):
    source_detail_id: int
    source_quantity: int
    target_detail_id: int
    target_quantity: int
    planned_quantity: int


class FulfillmentAdjustmentOut(BaseModel):
    id: int
    issue_id: int
    issue_number: int
    shipping_detail_id: Optional[int]
    adjustment_type: str
    source: str = "manual"
    quantity: int
    reason: str
    detail_name_snapshot: Optional[str]
    detail_phone_snapshot: Optional[str]
    detail_address_snapshot: Optional[str]
    detail_channel_snapshot: Optional[str]
    detail_company_snapshot: Optional[str]
    detail_quantity_snapshot: Optional[int]
    is_attributed: bool
    created_by: Optional[int]
    created_at: datetime

    model_config = {"from_attributes": True}


class FulfillmentAdjustmentIn(BaseModel):
    adjustment_type: str = Field(
        default="no_shipment_required",
        pattern="^(no_shipment_required|warehouse_stock_in)$",
    )
    quantity: int = Field(gt=0)
    reason: str = Field(min_length=1, max_length=255)
    shipping_detail_id: int


class FulfillmentAdjustmentAttributionIn(BaseModel):
    shipping_detail_id: int


class ManualPackageIn(BaseModel):
    carrier: str = Field(min_length=1, max_length=50)
    tracking_no: str = Field(min_length=1, max_length=100)
    quantity: int = Field(gt=0)
    shipped_at: Optional[datetime] = None


class NoTrackingRequirementIn(BaseModel):
    no_tracking_required: bool = True


class WaybillImportRowUpdate(BaseModel):
    carrier: Optional[str] = Field(default=None, max_length=50)
    tracking_no: Optional[str] = Field(default=None, max_length=100)
    recipient_name: Optional[str] = Field(default=None, max_length=100)
    phone: Optional[str] = Field(default=None, max_length=50)
    address: Optional[str] = None
    quantity: Optional[int] = None
    no_tracking_required: Optional[bool] = None
    shipping_detail_id: Optional[int] = None
    ignored: Optional[bool] = None
    ignore_reason: Optional[str] = Field(default=None, max_length=255)


class WaybillBulkMatchIn(BaseModel):
    row_ids: list[int] = Field(min_length=1)
    shipping_detail_id: int


class WaybillImportRowCreate(BaseModel):
    carrier: str = Field(default="中通", max_length=50)
    tracking_no: Optional[str] = Field(default=None, max_length=100)
    recipient_name: str = Field(default="", max_length=100)
    phone: Optional[str] = Field(default=None, max_length=50)
    address: Optional[str] = None
    quantity: int = 0
    no_tracking_required: bool = False
    shipping_detail_id: Optional[int] = None


FulfillmentSummaryOut.model_rebuild()
