from pydantic import BaseModel
from typing import List, Optional


class ReportEntryOut(BaseModel):
    id: int
    category: str
    sub_category: str
    destination: Optional[str] = None
    value: int
    is_variable: bool

    model_config = {"from_attributes": True}


class ReportEntryUpdate(BaseModel):
    category: str
    sub_category: str
    value: int


class DestinationSummary(BaseModel):
    destination: str
    total: int


class ReportDataOut(BaseModel):
    issue_id: int
    issue_number: int
    entries: List[ReportEntryOut]
    total: int
    destination_summary: List[DestinationSummary] = []


class ReportDataUpdate(BaseModel):
    entries: List[ReportEntryUpdate]


class TempPrintDetailIn(BaseModel):
    department: str
    custom_name: Optional[str] = None
    quantity: int
    self_quantity: int


class TempPrintDetailOut(TempPrintDetailIn):
    id: int
    model_config = {"from_attributes": True}
