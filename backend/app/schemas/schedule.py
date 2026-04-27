from pydantic import BaseModel
from datetime import date


class ScheduleEntry(BaseModel):
    id: int
    year: int
    issue_number: int | None
    publish_date: date
    is_suspended: bool

    model_config = {"from_attributes": True}
