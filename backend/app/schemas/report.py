from pydantic import BaseModel
from typing import List, Optional


class ReportEntryOut(BaseModel):
    id: int
    category: str
    sub_category: str
    value: int
    is_variable: bool

    model_config = {"from_attributes": True}


class ReportEntryUpdate(BaseModel):
    category: str
    sub_category: str
    value: int


class ReportDataOut(BaseModel):
    issue_id: int
    issue_number: int
    entries: List[ReportEntryOut]
    total: int


class ReportDataUpdate(BaseModel):
    entries: List[ReportEntryUpdate]
