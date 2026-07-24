import io
import zipfile
from urllib.parse import quote
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Issue, IssueAuditSnapshot, IssueStatus, ReportEntry, ShippingDetail, User
from app.auth import get_current_user
from app.services.report_destination_service import DESTINATION_ZTO, resolve_report_destination
from app.services.operation_log_service import record_operation
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


def _export_totals(issue: Issue, db: Session) -> tuple[int, int]:
    entries = db.query(ReportEntry).filter(ReportEntry.issue_id == issue.id).all()
    zt_report_total = sum(
        entry.value or 0
        for entry in entries
        if entry.sub_category not in _REPORT_TOTAL_EXCLUDED_SUB_CATEGORIES
        and resolve_report_destination(entry.category, entry.sub_category, entry.destination) == DESTINATION_ZTO
    )
    zt_shipping_total = (
        db.query(func.coalesce(func.sum(ShippingDetail.quantity), 0))
        .filter(ShippingDetail.issue_number == issue.issue_number)
        .scalar()
    )
    return zt_report_total, zt_shipping_total


def _get_export_ready_issue(db: Session, issue_id: int) -> tuple[Issue, int, int]:
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="刊期不存在")
    if issue.status not in {IssueStatus.confirmed, IssueStatus.exported}:
        raise HTTPException(status_code=409, detail="报数尚未确认，不能正式导出")
    report_total, shipping_total = _export_totals(issue, db)
    if report_total != shipping_total:
        raise HTTPException(
            status_code=409,
            detail=f"中通份数不一致：报数 {report_total} 份，发货明细 {shipping_total} 份",
        )
    return issue, report_total, shipping_total


def _persist_export_snapshot(
    issue: Issue,
    snapshot_type: str,
    report_total: int,
    shipping_total: int,
    db: Session,
) -> None:
    db.add(
        IssueAuditSnapshot(
            issue_id=issue.id,
            snapshot_type=snapshot_type,
            report_total=report_total,
            shipping_total=shipping_total,
            delta=report_total - shipping_total,
            is_match=True,
        )
    )
    db.commit()


@router.get("/report")
def export_report(issue_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    issue, report_total, shipping_total = _get_export_ready_issue(db, issue_id)

    output = export_report_excel(issue_id, db)
    record_operation(
        db,
        user=user,
        table_name="exports",
        record_id=issue.id,
        record_name=f"第{issue.issue_number}期",
        action="export_report",
        issue_number=issue.issue_number,
    )
    _persist_export_snapshot(issue, "report_export", report_total, shipping_total, db)
    filename = get_report_filename(issue)
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


@router.get("/shipping")
def export_shipping(issue_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    issue, report_total, shipping_total = _get_export_ready_issue(db, issue_id)

    output = export_shipping_excel(issue_id, db)
    record_operation(
        db,
        user=user,
        table_name="exports",
        record_id=issue.id,
        record_name=f"第{issue.issue_number}期",
        action="export_shipping",
        issue_number=issue.issue_number,
    )
    _persist_export_snapshot(issue, "shipping_export", report_total, shipping_total, db)
    filename = get_shipping_filename(issue)
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


@router.get("/all")
def export_all(issue_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    issue, report_total, shipping_total = _get_export_ready_issue(db, issue_id)

    report_bytes = export_report_excel(issue_id, db)
    shipping_bytes = export_shipping_excel(issue_id, db)
    record_operation(
        db,
        user=user,
        table_name="exports",
        record_id=issue.id,
        record_name=f"第{issue.issue_number}期",
        action="export_all",
        issue_number=issue.issue_number,
    )
    _persist_export_snapshot(issue, "report_export", report_total, shipping_total, db)
    _persist_export_snapshot(issue, "shipping_export", report_total, shipping_total, db)

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
