from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session
from typing import List

from app.auth import require_admin
from app.database import get_db
from app.models import PublicationSchedule, PublicationScheduleUpload, User
from app.schemas.publication_schedule_upload import (
    SchedulePreviewOut,
    ScheduleRowIn,
    ScheduleRowsUpdateIn,
    ScheduleSummaryOut,
    ScheduleUploadOut,
)
from app.schemas.schedule import ScheduleEntry
from app.services.publication_schedule_upload_service import (
    MAX_PDF_UPLOAD_BYTES,
    MAX_PDF_UPLOAD_MB,
    commit_schedule_upload,
    create_preview_upload,
    update_schedule_upload_rows,
)
from app.services.publication_schedule_parser import ScheduleRowDraft

router = APIRouter(prefix="/api/schedule", tags=["schedule"])


async def read_limited_upload(file: UploadFile) -> bytes:
    content = await file.read(MAX_PDF_UPLOAD_BYTES + 1)
    if len(content) > MAX_PDF_UPLOAD_BYTES:
        raise ValueError(f"PDF 文件不能超过 {MAX_PDF_UPLOAD_MB} MB")
    return content


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
        content = await read_limited_upload(file)
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


@router.put("/uploads/{upload_id}/rows", response_model=SchedulePreviewOut)
def update_schedule_upload_rows_endpoint(
    upload_id: int,
    body: ScheduleRowsUpdateIn,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Replace preview rows for a pending upload, then re-run validation."""
    try:
        upload, rows = update_schedule_upload_rows(
            db,
            upload_id,
            [
                ScheduleRowDraft(
                    publish_date=row.publish_date,
                    issue_number=None if row.is_suspended else row.issue_number,
                    is_suspended=row.is_suspended,
                )
                for row in body.rows
            ],
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
    page_count: int | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Persist server-stored preview rows from an upload into publication_schedule."""
    try:
        return commit_schedule_upload(db, upload_id, page_count=page_count)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
