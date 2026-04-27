from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models import Issue, ReportEntry, IssueStatus
from app.schemas.report import ReportDataOut, ReportDataUpdate, ReportEntryOut

router = APIRouter(prefix="/api/issues/{issue_id}/report", tags=["reports"])


@router.get("", response_model=ReportDataOut)
def get_report(issue_id: int, db: Session = Depends(get_db)):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    entries = (
        db.query(ReportEntry)
        .filter(ReportEntry.issue_id == issue_id)
        .order_by(ReportEntry.category, ReportEntry.id)
        .all()
    )
    total = sum(e.value for e in entries)
    return ReportDataOut(
        issue_id=issue.id,
        issue_number=issue.issue_number,
        entries=[ReportEntryOut.model_validate(e) for e in entries],
        total=total,
    )


@router.put("")
def update_report(issue_id: int, data: ReportDataUpdate, db: Session = Depends(get_db)):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    for entry_data in data.entries:
        entry = (
            db.query(ReportEntry)
            .filter(
                ReportEntry.issue_id == issue_id,
                ReportEntry.category == entry_data.category,
                ReportEntry.sub_category == entry_data.sub_category,
            )
            .first()
        )
        if entry:
            entry.value = entry_data.value

    db.commit()
    return {"message": "Report updated"}


@router.post("/confirm")
def confirm_report(issue_id: int, db: Session = Depends(get_db)):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    # Validation
    entries = db.query(ReportEntry).filter(ReportEntry.issue_id == issue_id).all()
    errors = []
    for e in entries:
        if e.is_variable and e.value is None:
            errors.append({"field": f"{e.category}/{e.sub_category}", "message": "必填变动项为空", "level": "error"})
        if e.value is not None and e.value < 0:
            errors.append({"field": f"{e.category}/{e.sub_category}", "message": "数值不能为负数", "level": "error"})

    if errors:
        raise HTTPException(status_code=422, detail=errors)

    issue.status = IssueStatus.confirmed
    db.commit()
    return {"message": "Report confirmed", "issue_number": issue.issue_number}
