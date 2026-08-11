from datetime import date, datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import Issue, ReportEntry, ReportSourceItem, User
from app.schemas.report_source import (
    IssueSourceSummaryOut,
    ReportSourceConfirmIn,
    ReportSourceDocumentOut,
    ReportSourceItemOut,
    ReportSourceUploadOut,
)
from app.services import attachment_service
from app.services.report_source_service import (
    _document_out,
    confirm_document,
    create_source_document,
    delete_source_document,
    get_document,
    get_issue_summary,
    update_adjustment_shipping,
)
from app.upload import read_upload


router = APIRouter(prefix="/api/report-sources", tags=["report-sources"])


class ShippingUpdateIn(BaseModel):
    shipped_quantity: int
    tracking_no: str | None = None
    shipped_at: datetime | None = None


@router.post("/upload", response_model=ReportSourceUploadOut, status_code=201)
async def upload_report_source(
    file: UploadFile = File(...),
    channel: str = Form(...),
    issue_number: int | None = Form(None),
    document_type: str | None = Form(None),
    source_date: date | None = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    filename = (file.filename or "").strip() or "source"
    content = await read_upload(file, label="来源文件")
    document, duplicate = create_source_document(
        db,
        user=user,
        channel=channel,
        filename=filename,
        content=content,
        mime_type=file.content_type,
        current_issue_number=issue_number,
        requested_document_type=document_type,
        requested_source_date=source_date,
    )
    document = get_document(db, document.id)
    return _document_out(document, upload=True, duplicate=duplicate)


@router.post("/{document_id}/confirm", response_model=ReportSourceDocumentOut)
def confirm_report_source(
    document_id: int,
    data: ReportSourceConfirmIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    document = get_document(db, document_id)
    return _document_out(confirm_document(db, document=document, data=data, user=user))


@router.get("/issues/{issue_id}", response_model=IssueSourceSummaryOut)
def get_issue_report_sources(issue_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(
            Issue.issue_number,
            ReportEntry.category,
            func.coalesce(func.sum(ReportEntry.value), 0),
        )
        .outerjoin(ReportEntry, ReportEntry.issue_id == Issue.id)
        .filter(Issue.id == issue_id)
        .group_by(Issue.issue_number, ReportEntry.category)
        .all()
    )
    if not rows:
        raise HTTPException(status_code=404, detail="刊期不存在")
    issue_number = rows[0][0]
    bases = {
        category: int(value or 0)
        for _number, category, value in rows
        if category is not None
    }
    return get_issue_summary(
        db,
        issue_number=issue_number,
        bases=bases,
    )


@router.get("/{document_id}/download")
def download_report_source(document_id: int, db: Session = Depends(get_db)):
    document = get_document(db, document_id)
    try:
        path = attachment_service.resolve_path(document.stored_path)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="来源文件路径无效") from exc
    if not path.exists():
        raise HTTPException(status_code=404, detail="来源文件丢失")
    return FileResponse(path, filename=document.original_filename, media_type=document.mime_type)


@router.patch("/items/{item_id}/shipping", response_model=ReportSourceItemOut)
def patch_adjustment_shipping(
    item_id: int,
    data: ShippingUpdateIn,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    item = db.query(ReportSourceItem).filter(ReportSourceItem.id == item_id).first()
    if item is None:
        raise HTTPException(status_code=404, detail="来源明细不存在")
    return ReportSourceItemOut.model_validate(
        update_adjustment_shipping(
            db,
            item=item,
            shipped_quantity=data.shipped_quantity,
            tracking_no=data.tracking_no,
            shipped_at=data.shipped_at,
        )
    )


@router.delete("/{document_id}", status_code=204)
def delete_report_source(
    document_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    document = get_document(db, document_id)
    delete_source_document(db, document=document, user=user)
