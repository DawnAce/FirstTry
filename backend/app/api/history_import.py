"""API routes for history import (template download, preview, commit)."""

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
import io
from urllib.parse import quote

from app.database import get_db
from app.schemas.history_import import (
    HistoryImportCommitIn,
    HistoryImportCommitOut,
    HistoryImportPreviewOut,
)
from app.services.history_import_service import (
    commit_history_import,
    preview_history_import,
)
from app.services.history_import_template_service import (
    build_report_import_template,
    build_shipping_import_template,
)

router = APIRouter(prefix="/api/history-import", tags=["history-import"])


@router.get("/templates/report")
def download_report_template(db: Session = Depends(get_db)):
    """Download the Excel template for the report (印数报数) history import."""
    content = build_report_import_template(db)
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote('印数导入模板.xlsx')}"},
    )


@router.get("/templates/shipping")
def download_shipping_template():
    """Download the Excel template for the shipping (发货) history import."""
    content = build_shipping_import_template()
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="history_shipping_template.xlsx"'},
    )


@router.post("/preview", response_model=HistoryImportPreviewOut)
async def preview_import(
    report_file: UploadFile = File(...),
    shipping_file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Parse and validate both Excel files; return a preview without persisting anything."""
    report_bytes = await report_file.read()
    shipping_bytes = await shipping_file.read()
    return preview_history_import(db, report_bytes, shipping_bytes)


@router.post("/commit", response_model=HistoryImportCommitOut)
def commit_import(
    body: HistoryImportCommitIn,
    db: Session = Depends(get_db),
):
    """Persist a previously previewed import from the cache session to the database."""
    return commit_history_import(db, body.import_session_id, body.manual_temp_rows)
