import io
import zipfile
from urllib.parse import quote
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Issue, IssueAuditSnapshot, ReportEntry, ShippingDetail
from app.services.report_destination_service import DESTINATION_ZTO, resolve_report_destination
from app.services.excel_service import (
    export_report_excel, export_shipping_excel,
    get_report_filename, get_shipping_filename,
)

router = APIRouter(prefix="/api/issues/{issue_id}/export", tags=["export"])

_REPORT_TOTAL_EXCLUDED_SUB_CATEGORIES = {
    "临时加印_自留",
    "营报传媒加印",
    "财经中心加印",
    "中经未来",
    "产经中心加印",
}


def _persist_shipping_export_snapshot(issue: Issue, db: Session) -> None:
    entries = db.query(ReportEntry).filter(ReportEntry.issue_id == issue.id).all()
    zt_report_total = sum(
        entry.value
        for entry in entries
        if entry.sub_category not in _REPORT_TOTAL_EXCLUDED_SUB_CATEGORIES
        and resolve_report_destination(entry.category, entry.sub_category, entry.destination) == DESTINATION_ZTO
    )
    zt_shipping_total = (
        db.query(func.coalesce(func.sum(ShippingDetail.quantity), 0))
        .filter(ShippingDetail.issue_number == issue.issue_number)
        .scalar()
    )
    db.add(
        IssueAuditSnapshot(
            issue_id=issue.id,
            snapshot_type="shipping_export",
            report_total=zt_report_total,
            shipping_total=zt_shipping_total,
            delta=zt_report_total - zt_shipping_total,
            is_match=zt_report_total == zt_shipping_total,
        )
    )
    db.commit()


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
    _persist_shipping_export_snapshot(issue, db)
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
