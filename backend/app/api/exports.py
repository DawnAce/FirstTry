import io
import zipfile
from urllib.parse import quote
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Issue
from app.services.excel_service import (
    export_report_excel, export_shipping_excel,
    get_report_filename, get_shipping_filename,
)

router = APIRouter(prefix="/api/issues/{issue_id}/export", tags=["export"])


@router.get("/report")
def export_report(issue_id: int, db: Session = Depends(get_db)):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    output = export_report_excel(issue_id, db)
    filename = get_report_filename(issue)
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


@router.get("/shipping")
def export_shipping(issue_id: int, db: Session = Depends(get_db)):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    output = export_shipping_excel(issue_id, db)
    filename = get_shipping_filename(issue)
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


@router.get("/all")
def export_all(issue_id: int, db: Session = Depends(get_db)):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    report_bytes = export_report_excel(issue_id, db)
    shipping_bytes = export_shipping_excel(issue_id, db)

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(get_report_filename(issue), report_bytes.read())
        zf.writestr(get_shipping_filename(issue), shipping_bytes.read())

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=issue_{issue.issue_number}.zip"},
    )
