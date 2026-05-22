from datetime import date, datetime
from pydantic import BaseModel, Field


class ScheduleSummaryOut(BaseModel):
    total_rows: int
    published_count: int
    suspended_count: int
    first_issue_number: int | None
    last_issue_number: int | None
    remarks: str | None = None


class ScheduleRowIn(BaseModel):
    publish_date: date
    issue_number: int | None = Field(default=None, ge=1)
    is_suspended: bool


class SchedulePreviewOut(BaseModel):
    upload_id: int
    year: int
    rows: list[ScheduleRowIn]
    summary: ScheduleSummaryOut
    errors: list[str]
    can_commit: bool


class ScheduleUploadOut(BaseModel):
    id: int
    year: int
    original_filename: str
    status: str
    summary_json: dict | None
    error_json: list[str] | None
    uploaded_by: str | None
    created_at: datetime | None
    committed_at: datetime | None
    model_config = {"from_attributes": True}
    model_config = {"from_attributes": True}
