from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


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

    model_config = {"from_attributes": True}


class FulfillmentSummaryOut(BaseModel):
    issue_id: int
    issue_number: int
    expected_quantity: int
    planned_quantity: int
    handled_quantity: int
    tracked_quantity: int
    no_tracking_quantity: int
    pending_quantity: int
    extra_quantity: int
    package_count: int
    pending_detail_count: int
    status: str
    latest_import: Optional[WaybillImportBatchOut] = None


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


class WaybillImportRowCreate(BaseModel):
    carrier: str = Field(default="中通", max_length=50)
    tracking_no: Optional[str] = Field(default=None, max_length=100)
    recipient_name: str = Field(default="", max_length=100)
    phone: Optional[str] = Field(default=None, max_length=50)
    address: Optional[str] = None
    quantity: int = 0
    no_tracking_required: bool = False
    shipping_detail_id: Optional[int] = None
