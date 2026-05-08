from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import List, Optional
from datetime import datetime
from app.database import get_db
from app.models import Issue, ReportEntry, IssueStatus, ReportRevision, User
from app.schemas.report import ReportDataOut, ReportDataUpdate, ReportEntryOut
from app.auth import get_current_user, require_admin

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

    if issue.status == IssueStatus.confirmed:
        raise HTTPException(status_code=403, detail="报数已确认，如需修改请先作废")

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
def confirm_report(issue_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
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


@router.post("/revoke")
def revoke_report(
    issue_id: int,
    reason: Optional[str] = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    """作废当前确认，记录快照，恢复为draft状态。仅管理员可操作。"""
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    if issue.status != IssueStatus.confirmed:
        raise HTTPException(status_code=400, detail="该期尚未确认，无需作废")

    # Get current entries as snapshot
    entries = db.query(ReportEntry).filter(ReportEntry.issue_id == issue_id).all()
    snapshot = [
        {"category": e.category, "sub_category": e.sub_category, "value": e.value}
        for e in entries
    ]

    # Determine revision number
    last_rev = (
        db.query(ReportRevision)
        .filter(ReportRevision.issue_id == issue_id)
        .order_by(desc(ReportRevision.revision_number))
        .first()
    )
    rev_number = (last_rev.revision_number + 1) if last_rev else 1

    # Create revision record
    revision = ReportRevision(
        issue_id=issue_id,
        revision_number=rev_number,
        operator_id=user.id,
        reason=reason,
        changes_json=snapshot,
        confirmed_at=issue.updated_at,
    )
    db.add(revision)

    # Revert to draft
    issue.status = IssueStatus.draft
    db.commit()

    return {"message": "报数已作废", "revision_number": rev_number}


@router.get("/revisions")
def get_revisions(issue_id: int, db: Session = Depends(get_db)):
    """获取该期的作废历史记录。"""
    revisions = (
        db.query(ReportRevision)
        .filter(ReportRevision.issue_id == issue_id)
        .order_by(ReportRevision.revision_number)
        .all()
    )
    return [
        {
            "id": r.id,
            "revision_number": r.revision_number,
            "operator": r.operator.username,
            "reason": r.reason,
            "changes_json": r.changes_json,
            "confirmed_at": r.confirmed_at.isoformat() if r.confirmed_at else None,
            "revoked_at": r.revoked_at.isoformat() if r.revoked_at else None,
        }
        for r in revisions
    ]
