"""邮局投递 · Pydantic schemas（批次 / 明细行 / 生成 / 提交）。"""

from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, Field

from app.models.postal_delivery import PostalBatchStatus


class BatchOut(BaseModel):
    id: int
    year: int
    month: int
    status: PostalBatchStatus
    generated_at: Optional[datetime] = None
    sent_at: Optional[datetime] = None
    row_count: int

    model_config = {"from_attributes": True}


class BatchRowOut(BaseModel):
    id: int
    snap_name: str
    snap_phone: Optional[str] = None
    snap_province: Optional[str] = None
    snap_city: Optional[str] = None
    snap_district: Optional[str] = None
    snap_address: str
    snap_postal_code: Optional[str] = None
    copies: int
    coverage_start_date: Optional[date] = None
    coverage_end_date: Optional[date] = None
    source_channel: Optional[str] = None
    distribution_unit_id: Optional[int] = None
    distribution_unit_name: Optional[str] = None
    salesperson: Optional[str] = None

    model_config = {"from_attributes": True}


class BatchDetailOut(BaseModel):
    batch: BatchOut
    rows: List[BatchRowOut]


class GenerateBatchIn(BaseModel):
    year: int = Field(ge=2000, le=2100)
    month: int = Field(ge=1, le=12)


class PostalCommitIn(BaseModel):
    session_id: str
