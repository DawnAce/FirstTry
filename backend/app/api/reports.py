from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, aliased
from sqlalchemy import case, desc, func, or_, select
from typing import List, Optional
from datetime import datetime
from app.database import get_db
from app.models import (
    Issue,
    IssueAuditSnapshot,
    IssueStatus,
    ReportEntry,
    ReportRevision,
    ReportSourceDocument,
    ReportSourceItem,
    ShippingDetail,
    ShippingDetailSourceType,
    ShippingFulfillmentAdjustment,
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
from app.services.report_source_service import get_report_source_mismatches
from app.services.report_source_ocr import CHANNEL_LABELS
from app.services.shipping_suspension_service import sync_plan_status_adjustment
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


def _apply_report_updates(
    entries: list[ReportEntry], data: ReportDataUpdate
) -> None:
    """Apply a report payload to already-loaded rows without per-entry SQL."""
    by_key = {(entry.category, entry.sub_category): entry for entry in entries}
    for entry_data in data.entries:
        entry = by_key.get((entry_data.category, entry_data.sub_category))
        if entry is not None:
            entry.value = entry_data.value


def _normalize_zero_temp_print(entries: list[ReportEntry]) -> bool:
    """Make a zero temporary-print total authoritative over allocations."""
    by_key = {(entry.category, entry.sub_category): entry for entry in entries}
    total = by_key.get(("social_use", "临时加印"))
    self_entry = by_key.get(("social_use", "临时加印_自留"))
    if total is None or (total.value or 0) != 0:
        return False
    if self_entry is not None:
        self_entry.value = 0
    return True


def _copy_previous_shipping_details_for_confirm(
    db: Session,
    issue: Issue,
    user: User,
) -> int:
    reusable_plan_source = or_(
        ShippingDetail.source_type.is_(None),
        ShippingDetail.source_type.notin_((
            ShippingDetailSourceType.complaint_makeup,
            ShippingDetailSourceType.recurring_generated,
        )),
    )
    db.query(Issue.id).filter(Issue.id == issue.id).with_for_update().first()
    locked_existing_ids = (
        db.query(ShippingDetail.id)
        .filter(
            ShippingDetail.issue_number == issue.issue_number,
            reusable_plan_source,
        )
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
        .filter(
            ShippingDetail.issue_number == previous_issue.issue_number,
            reusable_plan_source,
        )
        .order_by(ShippingDetail.id)
        .all()
    )
    for detail in previous_details:
        data = {field: getattr(detail, field) for field in _SHIPPING_DETAIL_COPY_FIELDS}
        copied_detail = ShippingDetail(
            **data,
            issue_number=issue.issue_number,
            confirmation=None,
            shipped_at=None,
        )
        db.add(copied_detail)
        db.flush()
        sync_plan_status_adjustment(db, detail=copied_detail, user=user)

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
    latest_snapshot = aliased(IssueAuditSnapshot)
    latest_snapshot_id = (
        select(IssueAuditSnapshot.id)
        .where(
            IssueAuditSnapshot.issue_id == Issue.id,
            IssueAuditSnapshot.snapshot_type == "confirm",
        )
        .order_by(IssueAuditSnapshot.created_at.desc(), IssueAuditSnapshot.id.desc())
        .limit(1)
        .correlate(Issue)
        .scalar_subquery()
    )
    gross_shipping_total_expr = (
        select(func.coalesce(func.sum(ShippingDetail.quantity), 0))
        .where(
            ShippingDetail.issue_number == Issue.issue_number,
            ShippingDetail.source_type != ShippingDetailSourceType.complaint_makeup,
        )
        .correlate(Issue)
        .scalar_subquery()
    )
    issue_row = (
        db.query(
            Issue,
            latest_snapshot.report_total,
            latest_snapshot.shipping_total,
            latest_snapshot.delta,
            latest_snapshot.is_match,
            gross_shipping_total_expr.label("gross_shipping_total"),
        )
        .outerjoin(latest_snapshot, latest_snapshot.id == latest_snapshot_id)
        .filter(Issue.id == issue_id)
        .first()
    )
    if not issue_row:
        raise HTTPException(status_code=404, detail="刊期不存在")
    (
        issue,
        confirmed_report_total,
        confirmed_shipping_total,
        confirmed_delta,
        confirmed_is_match,
        gross_shipping_total,
    ) = issue_row

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

    attributed_condition = or_(
        ShippingFulfillmentAdjustment.shipping_detail_id.isnot(None),
        ShippingFulfillmentAdjustment.detail_name_snapshot.isnot(None),
    )
    positive_quantity = case(
        (
            ShippingFulfillmentAdjustment.quantity > 0,
            ShippingFulfillmentAdjustment.quantity,
        ),
        else_=0,
    )
    attributed_adjustment_quantity, unattributed_adjustment_quantity = (
        db.query(
            func.coalesce(
                func.sum(
                    case(
                        (attributed_condition, positive_quantity),
                        else_=0,
                    )
                ),
                0,
            ),
            func.coalesce(
                func.sum(
                    case(
                        (attributed_condition, 0),
                        else_=positive_quantity,
                    )
                ),
                0,
            ),
        )
        .filter(
            ShippingFulfillmentAdjustment.issue_id == issue.id,
            ShippingFulfillmentAdjustment.adjustment_type == "no_shipment_required",
        )
        .one()
    )
    attributed_adjustment_quantity = max(int(attributed_adjustment_quantity or 0), 0)
    unattributed_adjustment_quantity = max(int(unattributed_adjustment_quantity or 0), 0)
    included_stopped_quantity = int(
        db.query(func.coalesce(func.sum(positive_quantity), 0))
        .join(
            ShippingDetail,
            ShippingDetail.id == ShippingFulfillmentAdjustment.shipping_detail_id,
        )
        .filter(
            ShippingFulfillmentAdjustment.issue_id == issue.id,
            ShippingFulfillmentAdjustment.adjustment_type == "no_shipment_required",
            ShippingDetail.status == "停发",
            ShippingDetail.shipping_requirement == "tracking_required",
        )
        .scalar()
        or 0
    )
    gross_shipping_total = int(gross_shipping_total or 0)
    # “当前计划”是仍需寄出的计划数量。仍保留在明细里的停发行从
    # 原始计划总数中扣除；历史上已经删掉停发行、仅留下归因记录的
    # 期次不再重复扣减。
    current_shipping_total = max(gross_shipping_total - included_stopped_quantity, 0)
    report_zt_total = destination_totals.get(DESTINATION_ZTO, 0)
    shipping_check = ShippingCheck(
        report_zt_total=report_zt_total,
        shipping_total=current_shipping_total,
        delta=report_zt_total - current_shipping_total,
        is_match=report_zt_total == current_shipping_total,
    )
    confirmation_summary = None
    if confirmed_report_total is not None:
        # The confirmed report is the business baseline for the plan. The
        # shipping snapshot remains an immutable audit record, but a plan that
        # is uploaded after confirmation is current and reconciled once it
        # matches the confirmed report (plus any attributed stop-shipment
        # adjustments).
        raw_plan_shortage = max(confirmed_report_total - current_shipping_total, 0)
        plan_attributed_quantity = min(attributed_adjustment_quantity, raw_plan_shortage)
        plan_unexplained_delta = (
            current_shipping_total + plan_attributed_quantity - confirmed_report_total
        )
        current_delta = confirmed_report_total - current_shipping_total
        confirmation_summary = ConfirmationSummary(
            confirmed_report_total=confirmed_report_total,
            confirmed_shipping_total=confirmed_shipping_total,
            confirmed_delta=confirmed_delta,
            confirmed_is_match=confirmed_is_match,
            current_shipping_total=current_shipping_total,
            current_delta=current_delta,
            current_is_match=current_delta == 0,
            has_shipping_drift=current_shipping_total != confirmed_shipping_total,
            plan_delta=current_shipping_total - confirmed_report_total,
            plan_is_match=current_shipping_total == confirmed_report_total,
            plan_attributed_quantity=plan_attributed_quantity,
            plan_unexplained_delta=plan_unexplained_delta,
            plan_is_reconciled=plan_unexplained_delta == 0,
            unattributed_adjustment_quantity=unattributed_adjustment_quantity,
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

    entries = db.query(ReportEntry).filter(ReportEntry.issue_id == issue_id).all()
    _apply_report_updates(entries, data)
    if _normalize_zero_temp_print(entries):
        db.query(TempPrintDetail).filter(TempPrintDetail.issue_id == issue_id).delete(
            synchronize_session=False
        )

    db.commit()
    invalidate_overview_cache()
    return {"message": "Report updated"}


@router.post("/confirm")
def confirm_report(
    issue_id: int,
    data: Optional[ReportDataUpdate] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    issue = db.query(Issue).filter(Issue.id == issue_id).with_for_update().first()
    if not issue:
        raise HTTPException(status_code=404, detail="刊期不存在")

    # Validation
    entries = db.query(ReportEntry).filter(ReportEntry.issue_id == issue_id).all()
    if data is not None:
        _apply_report_updates(entries, data)
    if _normalize_zero_temp_print(entries):
        db.query(TempPrintDetail).filter(TempPrintDetail.issue_id == issue_id).delete(
            synchronize_session=False
        )
    errors = []
    for e in entries:
        if e.is_variable and e.value is None:
            errors.append({"field": f"{e.category}/{e.sub_category}", "message": "必填变动项为空", "level": "error"})
        if e.value is not None and e.value < 0:
            errors.append({"field": f"{e.category}/{e.sub_category}", "message": "数值不能为负数", "level": "error"})

    for mismatch in get_report_source_mismatches(
        db,
        issue_number=issue.issue_number,
        entries=entries,
    ):
        category = str(mismatch["category"])
        sub_category = str(mismatch["sub_category"])
        channel_label = CHANNEL_LABELS.get(category, category)
        report_value = mismatch["report_value"]
        report_value_label = f"{report_value} 份" if report_value is not None else "缺少对应项目"
        errors.append({
            "field": f"{channel_label}/{sub_category}",
            "message": (
                f"来源确认值为 {mismatch['source_value']} 份，"
                f"当前印数为 {report_value_label}，请核对"
            ),
            "level": "error",
        })

    pending_sources = (
        db.query(ReportSourceItem)
        .filter(
            ReportSourceItem.issue_number == issue.issue_number,
            ReportSourceItem.source_status != "confirmed",
        )
        .all()
    )
    # A cross-issue document can stay globally "reviewed" while the current
    # issue is already confirmed. Only an upload anchored here with no mapping
    # for this issue is still an unresolved document-level blocker.
    unmapped_source_documents = (
        db.query(ReportSourceDocument)
        .filter(
            ReportSourceDocument.extraction_status != "confirmed",
            ReportSourceDocument.upload_issue_number == issue.issue_number,
            ~ReportSourceDocument.items.any(ReportSourceItem.issue_number == issue.issue_number),
        )
        .all()
    )
    for source in pending_sources:
        label = source.source_label or f"{source.category}/{source.sub_category}"
        message = "渠道数据仍待确认" if source.source_status == "channel_pending" else "来源识别仍待核对"
        errors.append({"field": label, "message": message, "level": "error"})
    for document in unmapped_source_documents:
        errors.append({
            "field": document.display_name,
            "message": "来源文件尚未识别或关联刊期",
            "level": "error",
        })

    if errors:
        raise HTTPException(status_code=422, detail=errors)

    shipping_details_copied = _copy_previous_shipping_details_for_confirm(db, issue, user)
    db.flush()

    zt_report_total = sum(
        e.value for e in entries
        if e.sub_category not in _REPORT_TOTAL_EXCLUDED_SUB_CATEGORIES
        and resolve_report_destination(e.category, e.sub_category, e.destination) == DESTINATION_ZTO
    )
    # MySQL returns Decimal for SUM even though quantity is an integer column.
    # Normalize before writing the value into the JSON operation log.
    zt_shipping_total = int((
        db.query(func.coalesce(func.sum(ShippingDetail.quantity), 0))
        .filter(
            ShippingDetail.issue_number == issue.issue_number,
            ShippingDetail.source_type != ShippingDetailSourceType.complaint_makeup,
        )
        .scalar()
    ) or 0)

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
