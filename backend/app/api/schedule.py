from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session
from typing import List

from app.auth import require_admin
from app.database import get_db
from app.models import Issue, PublicationSchedule, PublicationScheduleUpload, PublicationScheduleUploadStatus, User
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
    schedules = (
        db.query(PublicationSchedule)
        .filter(PublicationSchedule.year == year)
        .order_by(PublicationSchedule.publish_date)
        .all()
    )

    # Batch-fetch actual page_count from issues for all issue_numbers in this year
    issue_numbers = [s.issue_number for s in schedules if s.issue_number is not None]
    actual_map: dict[int, int] = {}
    if issue_numbers:
        rows = (
            db.query(Issue.issue_number, Issue.page_count)
            .filter(Issue.issue_number.in_(issue_numbers))
            .all()
        )
        actual_map = {r[0]: r[1] for r in rows}

    result = []
    for s in schedules:
        entry = ScheduleEntry(
            id=s.id,
            year=s.year,
            issue_number=s.issue_number,
            publish_date=s.publish_date,
            is_suspended=s.is_suspended,
            page_count=s.page_count,
            actual_page_count=actual_map.get(s.issue_number) if s.issue_number is not None else None,
        )
        result.append(entry)
    return result


@router.get("/uploads", response_model=list[ScheduleUploadOut])
def list_schedule_uploads(
    year: int | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(PublicationScheduleUpload)
    if year is not None:
        query = query.filter(PublicationScheduleUpload.year == year)
    uploads = query.order_by(PublicationScheduleUpload.created_at.desc()).all()

    # Auto-cleanup: if a committed upload exists for a year,
    # delete all previewed uploads for that year (stale leftovers)
    committed_years = {u.year for u in uploads if u.status == PublicationScheduleUploadStatus.committed}
    if committed_years:
        stale_ids = [
            u.id for u in uploads
            if u.status == PublicationScheduleUploadStatus.previewed and u.year in committed_years
        ]
        if stale_ids:
            db.query(PublicationScheduleUpload).filter(
                PublicationScheduleUpload.id.in_(stale_ids)
            ).delete(synchronize_session=False)
            db.commit()
            uploads = [u for u in uploads if u.id not in stale_ids]

    return uploads


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
                page_count=row.page_count,
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
                    page_count=row.page_count,
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
                page_count=row.page_count,
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


@router.delete("/uploads/{upload_id}")
def discard_schedule_upload(
    upload_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Discard a pending (previewed) upload record."""
    upload = (
        db.query(PublicationScheduleUpload)
        .filter(PublicationScheduleUpload.id == upload_id)
        .first()
    )
    if upload is None:
        raise HTTPException(status_code=404, detail="上传记录不存在")
    if upload.status != PublicationScheduleUploadStatus.previewed:
        raise HTTPException(status_code=400, detail="只能删除待确认的上传记录")
    db.delete(upload)
    db.commit()
    return {"detail": "已删除"}
