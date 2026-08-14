from pydantic import BaseModel, Field, model_validator
from typing import Optional
from datetime import date, datetime

from app.models.shipping_detail import ShippingDetailSourceType, ShippingDetailSyncStatus
from app.schemas.history_import import ShippingImportAdjustment, ShippingImportRow


class ShipDetailIn(BaseModel):
    """Payload for POST /shipping-details/{id}/ship — mark one row shipped."""

    # 省略则取记账当天；实发份数省略则默认 = 计划 quantity。
    shipped_at: Optional[date] = None
    shipped_quantity: Optional[int] = Field(default=None, ge=0)
    tracking_no: Optional[str] = Field(default=None, max_length=64)


class ShippingDetailCreate(BaseModel):
    issue_number: int
    sheet_name: str
    channel: str
    sub_channel: Optional[str] = None
    name: str
    transport: str = "中通物流"
    frequency: str = "每周"
    status: str = "正常"
    address: Optional[str] = None
    phone: Optional[str] = None
    quantity: int = 0
    deadline: Optional[str] = None
    notes: Optional[str] = None
    extra_info: Optional[str] = None
    station_name: Optional[str] = None
    station_hall: Optional[str] = None
    contact_person: Optional[str] = None
    seq_number: Optional[int] = None
    period_count: Optional[int] = None
    confirmation: Optional[str] = None
    company: Optional[str] = None
    shipped_at: Optional[str] = None


class ShippingDetailUpdate(BaseModel):
    channel: Optional[str] = None
    sub_channel: Optional[str] = None
    transport: Optional[str] = None
    frequency: Optional[str] = None
    status: Optional[str] = None
    name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    quantity: Optional[int] = None
    deadline: Optional[str] = None
    notes: Optional[str] = None
    extra_info: Optional[str] = None
    station_name: Optional[str] = None
    station_hall: Optional[str] = None
    contact_person: Optional[str] = None
    seq_number: Optional[int] = None
    period_count: Optional[int] = None
    confirmation: Optional[str] = None
    company: Optional[str] = None
    shipped_at: Optional[str] = None
    shipped_quantity: Optional[int] = None
    tracking_no: Optional[str] = None


class ShippingActualRecipientUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    address: Optional[str] = None
    phone: Optional[str] = Field(default=None, max_length=50)
    reason: str = Field(min_length=2, max_length=255)


class ShippingDetailBatchPatch(BaseModel):
    status: Optional[str] = None
    deadline: Optional[str] = None

    @model_validator(mode="after")
    def require_at_least_one_field(self):
        if self.status is None and self.deadline is None:
            raise ValueError("At least one update field is required")
        return self


class ShippingDetailBatchUpdate(BaseModel):
    ids: list[int] = Field(min_length=1)
    updates: ShippingDetailBatchPatch


class ShippingDetailBatchDelete(BaseModel):
    ids: list[int] = Field(min_length=1)


class ShippingDetailBatchResult(BaseModel):
    affected_count: int


class ShippingPlanImportPreviewOut(BaseModel):
    issue_id: int
    issue_number: int
    filename: str
    import_session_id: str = ""
    can_commit: bool = False
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    imported_row_count: int = 0
    imported_quantity: int = 0
    replaced_row_count: int = 0
    replaced_quantity: int = 0
    preserved_row_count: int = 0
    preserved_quantity: int = 0
    resulting_row_count: int = 0
    resulting_quantity: int = 0
    report_zto_total: int = 0
    confirmed_shipping_total: Optional[int] = None
    sample_rows: list[ShippingImportRow] = Field(default_factory=list)
    adjustments: list[ShippingImportAdjustment] = Field(default_factory=list)


class ShippingPlanImportCommitIn(BaseModel):
    import_session_id: str
    reason: str = Field(min_length=2, max_length=255)
    adjustments_confirmed: bool = False


class ShippingPlanImportCommitOut(BaseModel):
    issue_id: int
    issue_number: int
    deleted_count: int
    created_count: int
    preserved_count: int
    resulting_quantity: int
    restored_waybill_rows: int = 0
    restored_waybill_quantity: int = 0
    unresolved_waybill_rows: int = 0
    restored_adjustment_count: int = 0
    restored_deferral_count: int = 0


class ShippingDetailOut(BaseModel):
    id: int
    issue_number: int
    sheet_name: str
    channel: str
    sub_channel: Optional[str]
    transport: str
    frequency: str
    status: str
    name: str
    address: Optional[str]
    phone: Optional[str]
    actual_name: Optional[str] = None
    actual_address: Optional[str] = None
    actual_phone: Optional[str] = None
    actual_adjustment_reason: Optional[str] = None
    actual_adjusted_at: Optional[datetime] = None
    quantity: int
    deadline: Optional[str]
    notes: Optional[str]
    extra_info: Optional[str]
    station_name: Optional[str]
    station_hall: Optional[str]
    contact_person: Optional[str]
    seq_number: Optional[int]
    period_count: Optional[int]
    confirmation: Optional[str]
    company: Optional[str]
    shipped_at: Optional[datetime]
    shipped_quantity: Optional[int]
    tracking_no: Optional[str]
    shipping_requirement: Optional[str] = None
    physical_shipped_quantity: int
    no_shipment_quantity: int
    deferred_quantity: int = 0
    no_shipment_reason: Optional[str] = None
    handled_quantity: int
    package_count: int
    fulfillment_status: str
    packages: list["ShippingPackageOut"] = []
    order_id: Optional[int]
    order_item_id: Optional[int]
    fulfillment_target_id: Optional[int]
    complaint_makeup_item_id: Optional[int]
    complaint_makeup_task_id: Optional[int] = None
    complaint_ticket_id: Optional[int] = None
    postal_delivery_id: Optional[int] = None
    source_type: ShippingDetailSourceType
    sync_status: ShippingDetailSyncStatus
    created_at: Optional[datetime]
    updated_at: Optional[datetime]

    model_config = {"from_attributes": True}


class ShippingPackageOut(BaseModel):
    id: int
    carrier: str
    tracking_no: str
    quantity: int
    shipped_at: datetime

    model_config = {"from_attributes": True}


ShippingDetailOut.model_rebuild()
