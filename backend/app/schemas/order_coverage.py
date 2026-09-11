"""批量补订期的候选、预览与确认契约。"""
from datetime import date
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CoverageCandidate(BaseModel):
    key: str
    order_id: Optional[int] = None
    external_order_no: Optional[str] = None
    order_date: date
    source_platform: Optional[str] = None
    recipient_name: str
    publication: str
    subscription_term: Optional[str] = None
    delivery_method: Optional[str] = None
    coverage_start_date: Optional[date] = None
    coverage_end_date: Optional[date] = None
    version: str
    blocked_reason: Optional[str] = None


class CoverageCandidatesOut(BaseModel):
    rows: list[CoverageCandidate]
    total: int
    order_count: int


class CoverageChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str = Field(min_length=1, max_length=180)
    expected_version: str = Field(min_length=1, max_length=64)
    coverage_start_date: date
    coverage_end_date: date

    @model_validator(mode="after")
    def valid_range(self):
        if self.coverage_end_date < self.coverage_start_date:
            raise ValueError("结束日期不能早于开始日期")
        return self


class CoveragePreviewIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    import_session_id: Optional[str] = None
    changes: list[CoverageChange] = Field(min_length=1, max_length=500)
    reason: str = Field(min_length=1, max_length=255)

    @model_validator(mode="after")
    def unique_keys(self):
        if len({c.key for c in self.changes}) != len(self.changes):
            raise ValueError("同一明细不能重复提交")
        self.reason = self.reason.strip()
        if not self.reason:
            raise ValueError("请填写补录原因")
        return self


class CoveragePreviewRow(BaseModel):
    key: str
    external_order_no: Optional[str] = None
    publication: Optional[str] = None
    old_start: Optional[date] = None
    old_end: Optional[date] = None
    new_start: date
    new_end: date
    error: Optional[str] = None


class CoveragePreviewOut(BaseModel):
    preview_id: Optional[str] = None
    can_apply: bool
    rows: list[CoveragePreviewRow]
    order_count: int


class CoverageApplyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    preview_id: str = Field(min_length=1, max_length=64)


class CoverageApplyOut(BaseModel):
    updated: int
    order_count: int
    changes: list[CoverageChange]
    import_version: int | None = None
