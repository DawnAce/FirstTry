from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session
from typing import List

from app.auth import require_admin
from app.database import get_db
from app.models import PublicationSchedule, PublicationScheduleUpload, User
from app.schemas.publication_schedule_upload import (
    ScheduleCommitIn,
    SchedulePreviewOut,
    ScheduleRowIn,
    ScheduleSummaryOut,
    ScheduleUploadOut,
)
from app.schemas.schedule import ScheduleEntry
from app.services.publication_schedule_parser import ScheduleRowDraft
from app.services.publication_schedule_upload_service import (
    commit_schedule_upload,
    create_preview_upload,
)

router = APIRouter(prefix="/api/schedule", tags=["schedule"])


@router.get("", response_model=List[ScheduleEntry])
def list_schedule(year: int = 2026, db: Session = Depends(get_db)):
    return (
        db.query(PublicationSchedule)
        .filter(PublicationSchedule.year == year)
        .order_by(PublicationSchedule.publish_date)
        .all()
    )


@router.get("/uploads", response_model=list[ScheduleUploadOut])
def list_schedule_uploads(
    year: int | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(PublicationScheduleUpload)
    if year is not None:
        query = query.filter(PublicationScheduleUpload.year == year)
    return query.order_by(PublicationScheduleUpload.created_at.desc()).all()


@router.post("/uploads/preview", response_model=SchedulePreviewOut)
async def preview_schedule_upload(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Upload a PDF and parse schedule rows without writing final schedule data."""
    try:
        content = await file.read()
        upload, rows = create_preview_upload(
            db,
            file.filename or "publication_schedule.pdf",
            file.content_type,
            content,
            user.username,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    summary = upload.summary_json or {}
    errors = upload.error_json or []
    return SchedulePreviewOut(
        upload_id=upload.id,
        year=upload.year,
        rows=[
            ScheduleRowIn(
                publish_date=row.publish_date,
                issue_number=row.issue_number,
                is_suspended=row.is_suspended,
            )
            for row in rows
        ],
        summary=ScheduleSummaryOut(**summary),
        errors=errors,
        can_commit=len(errors) == 0,
    )


@router.post("/uploads/{upload_id}/commit", response_model=ScheduleUploadOut)
def commit_schedule_upload_endpoint(
    upload_id: int,
    body: ScheduleCommitIn,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Persist confirmed schedule rows from an upload into publication_schedule."""
    rows = [
        ScheduleRowDraft(
            publish_date=row.publish_date,
            issue_number=None if row.is_suspended else row.issue_number,
            is_suspended=row.is_suspended,
        )
        for row in body.rows
    ]
    try:
        return commit_schedule_upload(db, upload_id, rows)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
