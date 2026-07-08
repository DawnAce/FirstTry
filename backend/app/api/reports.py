from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
from typing import List, Optional
from datetime import datetime
from app.database import get_db
from app.models import (
    Issue,
    IssueAuditSnapshot,
    IssueStatus,
    ReportEntry,
    ReportRevision,
    ShippingDetail,
    TempPrintDetail,
    User,
)
from app.schemas.report import (
    ConfirmationSummary,
    DestinationSummary,
    ReportDataOut,
    ReportDataUpdate,
    ReportEntryOut,
    ShippingCheck,
    TempPrintDetailIn,
    TempPrintDetailOut,
)
from app.auth import get_current_user, require_admin
from app.services.report_destination_service import DESTINATION_ZTO, resolve_report_destination
from app.services.operation_log_service import record_operation
from app.cache import invalidate_overview_cache

router = APIRouter(prefix="/api/issues/{issue_id}/report", tags=["reports"])

_REPORT_TOTAL_EXCLUDED_SUB_CATEGORIES = {
    '临时加印_自留',
    '营报传媒加印',
    '财经中心加印',
    '中经未来',
    '产经中心加印',
}

_SHIPPING_DETAIL_COPY_FIELDS = [
    "sheet_name", "channel", "sub_channel", "transport", "frequency",
    "status", "name", "address", "phone", "quantity", "deadline",
    "notes", "extra_info", "station_name", "station_hall",
    "contact_person", "seq_number", "period_count", "company",
]


def _copy_previous_shipping_details_for_confirm(
    db: Session,
    issue: Issue,
    user: User,
) -> int:
    db.query(Issue.id).filter(Issue.id == issue.id).with_for_update().first()
    locked_existing_ids = (
        db.query(ShippingDetail.id)
        .filter(ShippingDetail.issue_number == issue.issue_number)
        .with_for_update()
        .all()
    )
    if locked_existing_ids:
        return 0

    previous_issue = (
        db.query(Issue)
        .filter(Issue.issue_number < issue.issue_number)
        .order_by(desc(Issue.issue_number))
        .first()
    )
    if not previous_issue:
        return 0

    previous_details = (
        db.query(ShippingDetail)
        .filter(ShippingDetail.issue_number == previous_issue.issue_number)
        .order_by(ShippingDetail.id)
        .all()
    )
    for detail in previous_details:
        data = {field: getattr(detail, field) for field in _SHIPPING_DETAIL_COPY_FIELDS}
        db.add(
            ShippingDetail(
                **data,
                issue_number=issue.issue_number,
                confirmation=None,
                shipped_at=None,
            )
        )

    copied = len(previous_details)
    record_operation(
        db,
        user=user,
        table_name="shipping_details",
        record_id=0,
        record_name=f"批量复制到{issue.issue_number}期",
        action="batch_copy",
        issue_number=issue.issue_number,
        changes={
            "from_issue": previous_issue.issue_number,
            "to_issue": issue.issue_number,
            "count": copied,
        },
    )
    return copied


@router.get("", response_model=ReportDataOut)
def get_report(issue_id: int, db: Session = Depends(get_db)):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="刊期不存在")

    entries = (
        db.query(ReportEntry)
        .filter(ReportEntry.issue_id == issue_id)
        .order_by(ReportEntry.category, ReportEntry.id)
        .all()
    )
    # Exclude sub-allocations and deprecated department extras from total
    excluded = _REPORT_TOTAL_EXCLUDED_SUB_CATEGORIES
    total = sum(e.value for e in entries if e.sub_category not in excluded)
    destination_totals: dict[str, int] = {}
    for e in entries:
        if e.sub_category in excluded:
            continue
        destination = resolve_report_destination(e.category, e.sub_category, e.destination)
        destination_totals[destination] = destination_totals.get(destination, 0) + e.value

    latest_confirmation = (
        db.query(IssueAuditSnapshot)
        .filter(
            IssueAuditSnapshot.issue_id == issue.id,
            IssueAuditSnapshot.snapshot_type == "confirm",
        )
        .order_by(IssueAuditSnapshot.created_at.desc(), IssueAuditSnapshot.id.desc())
        .first()
    )
    current_shipping_total = (
        db.query(func.coalesce(func.sum(ShippingDetail.quantity), 0))
        .filter(ShippingDetail.issue_number == issue.issue_number)
        .scalar()
    )
    report_zt_total = destination_totals.get(DESTINATION_ZTO, 0)
    shipping_check = ShippingCheck(
        report_zt_total=report_zt_total,
        shipping_total=current_shipping_total,
        delta=report_zt_total - current_shipping_total,
        is_match=report_zt_total == current_shipping_total,
    )
    confirmation_summary = None
    if latest_confirmation:
        current_delta = latest_confirmation.report_total - current_shipping_total
        confirmation_summary = ConfirmationSummary(
            confirmed_report_total=latest_confirmation.report_total,
            confirmed_shipping_total=latest_confirmation.shipping_total,
            confirmed_delta=latest_confirmation.delta,
            confirmed_is_match=latest_confirmation.is_match,
            current_shipping_total=current_shipping_total,
            current_delta=current_delta,
            current_is_match=current_delta == 0,
            has_shipping_drift=current_shipping_total != latest_confirmation.shipping_total,
        )

    return ReportDataOut(
        issue_id=issue.id,
        issue_number=issue.issue_number,
        entries=[ReportEntryOut.model_validate(e) for e in entries],
        total=total,
        destination_summary=[
            DestinationSummary(destination=destination, total=destination_total)
            for destination, destination_total in destination_totals.items()
        ],
        shipping_check=shipping_check,
        confirmation_summary=confirmation_summary,
    )


@router.put("")
def update_report(issue_id: int, data: ReportDataUpdate, db: Session = Depends(get_db)):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="刊期不存在")

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
    invalidate_overview_cache()
    return {"message": "Report updated"}


@router.post("/confirm")
def confirm_report(issue_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    issue = db.query(Issue).filter(Issue.id == issue_id).with_for_update().first()
    if not issue:
        raise HTTPException(status_code=404, detail="刊期不存在")

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

    shipping_details_copied = _copy_previous_shipping_details_for_confirm(db, issue, user)
    db.flush()

    zt_report_total = sum(
        e.value for e in entries
        if e.sub_category not in _REPORT_TOTAL_EXCLUDED_SUB_CATEGORIES
        and resolve_report_destination(e.category, e.sub_category, e.destination) == DESTINATION_ZTO
    )
    zt_shipping_total = (
        db.query(func.coalesce(func.sum(ShippingDetail.quantity), 0))
        .filter(ShippingDetail.issue_number == issue.issue_number)
        .scalar()
    )

    db.add(
        IssueAuditSnapshot(
            issue_id=issue.id,
            snapshot_type="confirm",
            report_total=zt_report_total,
            shipping_total=zt_shipping_total,
            delta=zt_report_total - zt_shipping_total,
            is_match=zt_report_total == zt_shipping_total,
            created_by=user.username,
        )
    )
    issue.status = IssueStatus.confirmed
    record_operation(
        db,
        user=user,
        table_name="reports",
        record_id=issue.id,
        record_name=f"第{issue.issue_number}期",
        action="confirm",
        issue_number=issue.issue_number,
        changes={
            "zt_report_total": zt_report_total,
            "zt_shipping_total": zt_shipping_total,
            "delta": zt_report_total - zt_shipping_total,
        },
    )
    db.commit()
    result = {
        "message": "Report confirmed",
        "issue_number": issue.issue_number,
        "shipping_details_copied": shipping_details_copied,
        "zt_report_total": zt_report_total,
        "zt_shipping_total": zt_shipping_total,
    }
    if zt_report_total != zt_shipping_total:
        result["warning"] = (
            f"中通物流份数不一致：报数合计 {zt_report_total} 份，"
            f"发货明细合计 {zt_shipping_total} 份，请核查"
        )
    return result


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
        raise HTTPException(status_code=404, detail="刊期不存在")

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
    record_operation(
        db,
        user=user,
        table_name="reports",
        record_id=issue.id,
        record_name=f"第{issue.issue_number}期",
        action="revoke",
        issue_number=issue.issue_number,
        changes={"revision_number": rev_number, "reason": reason},
    )
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


@router.get("/temp-details", response_model=List[TempPrintDetailOut])
def get_temp_print_details(issue_id: int, db: Session = Depends(get_db)):
    """获取临时加印归属明细。"""
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="刊期不存在")

    details = (
        db.query(TempPrintDetail)
        .filter(TempPrintDetail.issue_id == issue_id)
        .order_by(TempPrintDetail.id)
        .all()
    )
    return [TempPrintDetailOut.model_validate(d) for d in details]


@router.put("/temp-details", response_model=List[TempPrintDetailOut])
def update_temp_print_details(
    issue_id: int,
    details: List[TempPrintDetailIn],
    db: Session = Depends(get_db),
):
    """替换临时加印归属明细，并同步更新临时加印_自留条目。"""
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="刊期不存在")

    if issue.status == IssueStatus.confirmed:
        raise HTTPException(status_code=403, detail="报数已确认，如需修改请先作废")

    # Delete existing details
    db.query(TempPrintDetail).filter(TempPrintDetail.issue_id == issue_id).delete()

    # Insert new details
    new_records = []
    for d in details:
        record = TempPrintDetail(
            issue_id=issue_id,
            department=d.department,
            custom_name=d.custom_name,
            quantity=d.quantity,
            self_quantity=d.self_quantity,
        )
        db.add(record)
        new_records.append(record)

    # Sync 临时加印_自留 entry value
    total_self = sum(d.self_quantity for d in details)
    self_entry = (
        db.query(ReportEntry)
        .filter(
            ReportEntry.issue_id == issue_id,
            ReportEntry.category == "social_use",
            ReportEntry.sub_category == "临时加印_自留",
        )
        .first()
    )
    if self_entry:
        self_entry.value = total_self

    db.commit()
    for r in new_records:
        db.refresh(r)

    return [TempPrintDetailOut.model_validate(r) for r in new_records]
