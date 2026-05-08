from pydantic import BaseModel
from datetime import date, datetime
from typing import Optional
from app.models.issue import IssueStatus


class IssueCreate(BaseModel):
    issue_number: int
    publish_date: date
    notes: Optional[str] = None


class IssueUpdate(BaseModel):
    page_count: Optional[int] = None
    notes: Optional[str] = None


class IssueOut(BaseModel):
    id: int
    issue_number: int
    publish_date: date
    page_count: int = 24
    status: IssueStatus
    notes: Optional[str]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]

    model_config = {"from_attributes": True}


class NextIssueInfo(BaseModel):
    issue_number: int
    publish_date: date
    previous_issue_id: Optional[int] = None
