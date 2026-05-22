from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import List, Optional
from app.database import get_db
from app.cache import invalidate_dashboard_cache
from app.auth import require_admin
from app.models import Issue, ShippingDetail, User
from app.models.report_revision import ReportRevision
from app.schemas.issue import IssueCreate, IssueOut, IssueUpdate, NextIssueInfo
from app.services.issue_service import build_issue_out, get_next_issue_info, get_available_issues, create_issue_with_data

router = APIRouter(prefix="/api/issues", tags=["issues"])


@router.get("", response_model=List[IssueOut])
def list_issues(skip: int = 0, limit: int = 20, db: Session = Depends(get_db)):
    issues = db.query(Issue).order_by(desc(Issue.issue_number)).offset(skip).limit(limit).all()
    return [build_issue_out(db, issue) for issue in issues]


@router.get("/next", response_model=Optional[NextIssueInfo])
def next_issue(db: Session = Depends(get_db)):
    info = get_next_issue_info(db)
    if not info:
        raise HTTPException(status_code=404, detail="No upcoming issues found in schedule")
    return info


@router.get("/available", response_model=List[NextIssueInfo])
def available_issues(db: Session = Depends(get_db)):
    """List all uncreated issues from the schedule for user to pick from."""
    return get_available_issues(db)


@router.post("", response_model=IssueOut, status_code=201)
def create_issue(data: IssueCreate, db: Session = Depends(get_db)):
    existing = db.query(Issue).filter(Issue.issue_number == data.issue_number).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Issue {data.issue_number} already exists")
    result = create_issue_with_data(db, data.issue_number, data.publish_date, data.notes)
    invalidate_dashboard_cache()
    return build_issue_out(db, result)


@router.get("/{issue_id}", response_model=IssueOut)
def get_issue(issue_id: int, db: Session = Depends(get_db)):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    return build_issue_out(db, issue)


@router.patch("/{issue_id}", response_model=IssueOut)
def update_issue(issue_id: int, data: IssueUpdate, db: Session = Depends(get_db)):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    if data.page_count is not None:
        issue.page_count = data.page_count
    if data.notes is not None:
        issue.notes = data.notes
    db.commit()
    db.refresh(issue)
    return build_issue_out(db, issue)


@router.delete("/{issue_id}")
def delete_issue(issue_id: int, db: Session = Depends(get_db), _user: User = Depends(require_admin)):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    issue_number = issue.issue_number
    db.query(ShippingDetail).filter(ShippingDetail.issue_number == issue_number).delete()
    db.query(ReportRevision).filter(ReportRevision.issue_id == issue.id).delete()
    db.delete(issue)
    db.commit()
    invalidate_dashboard_cache()
    return {"message": "Issue deleted"}
