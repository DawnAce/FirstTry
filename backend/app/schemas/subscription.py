"""邮局订报数据生成模块 · Pydantic schemas（In/Out 分离）。"""

from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, Field

from app.models.subscription_batch import (
    SubscriptionArtifactType,
    SubscriptionBatchStatus,
    SubscriptionImportStatus,
    SubscriptionIssueLevel,
    SubscriptionRunStatus,
)


# --- 批次 --------------------------------------------------------------------

class BatchCreateIn(BaseModel):
    year: int = Field(ge=2000, le=2100)
    start_month: int = Field(ge=1, le=12)
    make_date: Optional[date] = None
    unit_price: Optional[Decimal] = Field(default=None, ge=0)
    notes: Optional[str] = None


class BatchOut(BaseModel):
    id: int
    year: int
    start_month: int
    make_date: Optional[date] = None
    unit_price: Optional[Decimal] = None
    status: SubscriptionBatchStatus
    active_version_id: Optional[int] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class BatchDetailOut(BatchOut):
    versions: List["ImportVersionOut"] = []


# --- 导入版本 ----------------------------------------------------------------

class SourceFileOut(BaseModel):
    id: int
    file_role: str
    file_type: Optional[str] = None
    original_filename: str
    size: Optional[int] = None
    sha256: Optional[str] = None

    model_config = {"from_attributes": True}


class ImportVersionOut(BaseModel):
    id: int
    batch_id: int
    version_no: int
    status: SubscriptionImportStatus
    reason: Optional[str] = None
    summary_json: Optional[dict] = None
    uploaded_at: Optional[datetime] = None
    source_files: List[SourceFileOut] = []

    model_config = {"from_attributes": True}


class ValidationIssueOut(BaseModel):
    id: int
    level: SubscriptionIssueLevel
    source: Optional[str] = None
    sheet_or_file: Optional[str] = None
    row_no: Optional[int] = None
    field: Optional[str] = None
    code: Optional[str] = None
    message: str

    model_config = {"from_attributes": True}


class ImportStatusOut(BaseModel):
    """导入版本的解析/校验状态 + 问题计数。"""

    version: ImportVersionOut
    issue_counts: dict  # {block: n, warn: n, info: n}
    can_activate: bool


# --- 生成 --------------------------------------------------------------------

class ArtifactOut(BaseModel):
    id: int
    artifact_type: SubscriptionArtifactType
    region_name: Optional[str] = None
    filename: str
    sha256: Optional[str] = None
    is_historical: bool
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class GenerationRunOut(BaseModel):
    id: int
    batch_id: int
    version_id: int
    rule_version: Optional[str] = None
    template_version: Optional[str] = None
    status: SubscriptionRunStatus
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    error: Optional[str] = None
    artifacts: List[ArtifactOut] = []

    model_config = {"from_attributes": True}


BatchDetailOut.model_rebuild()
