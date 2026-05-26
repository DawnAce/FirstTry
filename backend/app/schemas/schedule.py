from pydantic import BaseModel
from datetime import date
from typing import Optional


class ScheduleEntry(BaseModel):
    id: int
    year: int
    issue_number: int | None
    publish_date: date
    is_suspended: bool
    page_count: int | None = None
    actual_page_count: Optional[int] = None

    model_config = {"from_attributes": True}
