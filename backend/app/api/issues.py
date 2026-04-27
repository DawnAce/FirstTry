from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import List, Optional
from app.database import get_db
from app.models import Issue
from app.schemas.issue import IssueCreate, IssueOut, NextIssueInfo
from app.services.issue_service import get_next_issue_info, create_issue_with_data

router = APIRouter(prefix="/api/issues", tags=["issues"])


@router.get("", response_model=List[IssueOut])
def list_issues(skip: int = 0, limit: int = 20, db: Session = Depends(get_db)):
    return db.query(Issue).order_by(desc(Issue.issue_number)).offset(skip).limit(limit).all()


@router.get("/next", response_model=Optional[NextIssueInfo])
def next_issue(db: Session = Depends(get_db)):
    info = get_next_issue_info(db)
    if not info:
        raise HTTPException(status_code=404, detail="No upcoming issues found in schedule")
    return info


@router.post("", response_model=IssueOut, status_code=201)
def create_issue(data: IssueCreate, db: Session = Depends(get_db)):
    existing = db.query(Issue).filter(Issue.issue_number == data.issue_number).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Issue {data.issue_number} already exists")
    return create_issue_with_data(db, data.issue_number, data.publish_date, data.notes)


@router.get("/{issue_id}", response_model=IssueOut)
def get_issue(issue_id: int, db: Session = Depends(get_db)):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    return issue
