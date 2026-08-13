"""Preview and atomically replace one issue's imported ZTO shipping plan."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.history_import_cache import (
    get_history_import_session,
    pop_history_import_session,
    save_history_import_session,
)
from app.models import (
    Issue,
    IssueAuditSnapshot,
    ReportEntry,
    ShippingDetail,
    ShippingDetailSourceType,
)
from app.models.user import User
from app.schemas.history_import import ShippingImportAdjustment, ShippingImportRow
from app.schemas.shipping_detail import (
    ShippingPlanImportCommitOut,
    ShippingPlanImportPreviewOut,
)
from app.services.history_import_service import (
    _is_template_shipping_workbook,
    _parse_issue_number,
    _read_basic_info,
    _read_shipping_rows,
)
from app.services.operation_log_service import record_operation
from app.services.original_zto_shipping_import_service import (
    is_original_zto_shipping_workbook,
    normalize_shipping_sub_channels_with_adjustments,
    read_original_zto_shipping_basic_info,
    read_original_zto_shipping_rows_with_adjustments,
)
from app.services.report_destination_service import DESTINATION_ZTO, resolve_report_destination
from app.services.workbook_loader import load_uploaded_workbook


_REPLACEABLE_SOURCE_TYPES = (
    ShippingDetailSourceType.manual,
    ShippingDetailSourceType.historical_import,
)

_REPORT_TOTAL_EXCLUDED_SUB_CATEGORIES = {
    "临时加印_自留",
    "营报传媒加印",
    "财经中心加印",
    "中经未来",
    "产经中心加印",
}


def _replaceable_filter(issue_number: int):
    return (
        ShippingDetail.issue_number == issue_number,
        or_(
            ShippingDetail.source_type.is_(None),
            ShippingDetail.source_type.in_(_REPLACEABLE_SOURCE_TYPES),
        ),
    )


def _detail_signature(details: list[ShippingDetail]) -> list[dict[str, Any]]:
    return [
        {
            "id": detail.id,
            "updated_at": detail.updated_at.isoformat() if detail.updated_at else None,
            "quantity": detail.quantity or 0,
        }
        for detail in details
    ]


def _parse_shipping_file(
    content: bytes,
) -> tuple[int | None, list[ShippingImportRow], list[str], list[ShippingImportAdjustment]]:
    workbook = load_uploaded_workbook(content, file_label="中通发货文件")
    if _is_template_shipping_workbook(workbook):
        issue_number = _parse_issue_number(_read_basic_info(workbook).get("期号"))
        rows, warnings, adjustments = normalize_shipping_sub_channels_with_adjustments(
            _read_shipping_rows(workbook)
        )
        return issue_number, rows, warnings, adjustments
    if is_original_zto_shipping_workbook(workbook):
        issue_number = _parse_issue_number(read_original_zto_shipping_basic_info(workbook).get("期号"))
        rows, warnings, adjustments = read_original_zto_shipping_rows_with_adjustments(workbook)
        return issue_number, rows, warnings, adjustments
    raise HTTPException(
        status_code=400,
        detail="中通发货文件格式不支持，请上传系统发货明细模板或原始中通多工作表文件",
    )


def _report_zto_total(db: Session, issue_id: int) -> int:
    entries = db.query(ReportEntry).filter(ReportEntry.issue_id == issue_id).all()
    return sum(
        (entry.value or 0)
        for entry in entries
        if entry.sub_category not in _REPORT_TOTAL_EXCLUDED_SUB_CATEGORIES
        and resolve_report_destination(entry.category, entry.sub_category, entry.destination) == DESTINATION_ZTO
    )


def _confirmed_shipping_total(db: Session, issue_id: int) -> int | None:
    snapshot = (
        db.query(IssueAuditSnapshot)
        .filter(
            IssueAuditSnapshot.issue_id == issue_id,
            IssueAuditSnapshot.snapshot_type == "confirm",
        )
        .order_by(IssueAuditSnapshot.created_at.desc(), IssueAuditSnapshot.id.desc())
        .first()
    )
    return snapshot.shipping_total if snapshot else None


def _has_fulfillment_history(detail: ShippingDetail) -> bool:
    return bool(
        detail.shipped_at
        or detail.shipped_quantity is not None
        or detail.tracking_no
        or detail.packages
        or detail.fulfillment_adjustments
        or detail.deferrals
        or detail.package_allocations
    )


def preview_shipping_plan_import(
    db: Session,
    *,
    issue_id: int,
    filename: str,
    content: bytes,
) -> ShippingPlanImportPreviewOut:
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="刊期不存在")

    file_issue_number, rows, warnings, adjustments = _parse_shipping_file(content)
    errors: list[str] = []
    if file_issue_number is None:
        errors.append("无法从中通文件识别期号，请检查基本信息或原表标题")
    elif file_issue_number != issue.issue_number:
        errors.append(f"文件期号为 {file_issue_number}，当前页面为 {issue.issue_number} 期，不能导入")
    if not rows:
        errors.append("文件中没有可导入的发货明细")
    negative_rows = [index + 1 for index, row in enumerate(rows) if row.quantity < 0]
    if negative_rows:
        errors.append(f"发现 {len(negative_rows)} 条负数份数，不能导入")

    replaceable = (
        db.query(ShippingDetail)
        .filter(*_replaceable_filter(issue.issue_number))
        .order_by(ShippingDetail.id)
        .all()
    )
    protected_rows = [detail for detail in replaceable if _has_fulfillment_history(detail)]
    if protected_rows:
        errors.append(
            f"现有明细中有 {len(protected_rows)} 条已经关联运单、实发或核销记录，"
            "为保护发货历史不能整批替换，请先人工核对这些记录"
        )

    preserved = (
        db.query(ShippingDetail)
        .filter(
            ShippingDetail.issue_number == issue.issue_number,
            ShippingDetail.source_type.notin_(_REPLACEABLE_SOURCE_TYPES),
        )
        .all()
    )
    imported_quantity = sum(row.quantity or 0 for row in rows)
    replaced_quantity = sum(detail.quantity or 0 for detail in replaceable)
    preserved_quantity = sum(detail.quantity or 0 for detail in preserved)
    resulting_quantity = imported_quantity + preserved_quantity
    report_total = _report_zto_total(db, issue.id)
    confirmed_total = _confirmed_shipping_total(db, issue.id)
    if report_total != resulting_quantity:
        warnings.append(
            f"导入后的当前计划为 {resulting_quantity} 份，与报数中的中通合计 {report_total} 份相差 "
            f"{abs(report_total - resulting_quantity)} 份；导入不会修改已确认印数"
        )

    session_id = ""
    if not errors:
        session_id = save_history_import_session({
            "kind": "shipping_plan_replace",
            "issue_id": issue.id,
            "issue_number": issue.issue_number,
            "filename": filename,
            "rows": [row.model_dump() for row in rows],
            "adjustment_count": len(adjustments),
            "replaceable_signature": _detail_signature(replaceable),
        })

    return ShippingPlanImportPreviewOut(
        issue_id=issue.id,
        issue_number=issue.issue_number,
        filename=filename,
        import_session_id=session_id,
        can_commit=not errors,
        errors=errors,
        warnings=warnings,
        imported_row_count=len(rows),
        imported_quantity=imported_quantity,
        replaced_row_count=len(replaceable),
        replaced_quantity=replaced_quantity,
        preserved_row_count=len(preserved),
        preserved_quantity=preserved_quantity,
        resulting_row_count=len(rows) + len(preserved),
        resulting_quantity=resulting_quantity,
        report_zto_total=report_total,
        confirmed_shipping_total=confirmed_total,
        sample_rows=rows[:8],
        adjustments=adjustments,
    )


def _detail_from_row(issue_number: int, row: ShippingImportRow) -> ShippingDetail:
    return ShippingDetail(
        issue_number=issue_number,
        sheet_name=row.sheet_name,
        channel=row.channel,
        sub_channel=row.sub_channel or None,
        transport=row.transport,
        frequency=row.frequency,
        status=row.status,
        name=row.name,
        address=row.address,
        phone=row.phone,
        quantity=row.quantity,
        deadline=row.deadline,
        notes=row.notes,
        extra_info=row.extra_info,
        station_name=row.station_name,
        station_hall=row.station_hall,
        contact_person=row.contact_person,
        seq_number=row.seq_number,
        period_count=row.period_count,
        confirmation=row.confirmation,
        company=row.company,
        source_type=ShippingDetailSourceType.historical_import,
    )


def commit_shipping_plan_import(
    db: Session,
    *,
    issue_id: int,
    import_session_id: str,
    reason: str,
    user: User,
    adjustments_confirmed: bool = False,
) -> ShippingPlanImportCommitOut:
    payload = get_history_import_session(import_session_id)
    if payload is None or payload.get("kind") != "shipping_plan_replace":
        raise HTTPException(status_code=400, detail="导入预览已过期，请重新上传并预览")
    if payload.get("issue_id") != issue_id:
        raise HTTPException(status_code=400, detail="导入预览不属于当前刊期")
    if payload.get("adjustment_count", 0) > 0 and not adjustments_confirmed:
        raise HTTPException(status_code=400, detail="请先逐条核对并确认自动调整明细")

    issue = db.query(Issue).filter(Issue.id == issue_id).with_for_update().first()
    if not issue or issue.issue_number != payload.get("issue_number"):
        raise HTTPException(status_code=404, detail="刊期不存在或已发生变化")
    replaceable = (
        db.query(ShippingDetail)
        .filter(*_replaceable_filter(issue.issue_number))
        .order_by(ShippingDetail.id)
        .all()
    )
    if _detail_signature(replaceable) != payload.get("replaceable_signature"):
        raise HTTPException(status_code=409, detail="预览后本期发货明细已发生变化，请重新预览")
    if any(_has_fulfillment_history(detail) for detail in replaceable):
        raise HTTPException(status_code=409, detail="本期明细已关联新的运单或核销记录，请重新预览")

    rows = [ShippingImportRow(**row) for row in payload.get("rows", [])]
    old_quantity = sum(detail.quantity or 0 for detail in replaceable)
    old_ids = [detail.id for detail in replaceable]
    for detail in replaceable:
        db.delete(detail)
    db.flush()
    for row in rows:
        db.add(_detail_from_row(issue.issue_number, row))
    db.flush()

    # A legacy clear could leave confirmed import rows without their deleted
    # package/detail links. Reconnect those preserved rows to the newly imported
    # plan before publishing the replacement result.
    from app.services.shipping_waybill_service import restore_orphaned_confirmed_waybills

    restore_result = restore_orphaned_confirmed_waybills(db, issue=issue)

    preserved_count = (
        db.query(ShippingDetail)
        .filter(
            ShippingDetail.issue_number == issue.issue_number,
            ShippingDetail.source_type.notin_(_REPLACEABLE_SOURCE_TYPES),
        )
        .count()
    )
    new_quantity = sum(row.quantity or 0 for row in rows)
    preserved_quantity = int(sum(
        quantity or 0
        for (quantity,) in db.query(ShippingDetail.quantity).filter(
            ShippingDetail.issue_number == issue.issue_number,
            ShippingDetail.source_type.notin_(_REPLACEABLE_SOURCE_TYPES),
        ).all()
    ))
    record_operation(
        db,
        user=user,
        table_name="shipping_details",
        record_id=0,
        record_name=f"重新上传{issue.issue_number}期中通明细",
        action="replace_shipping",
        issue_number=issue.issue_number,
        changes={
            "filename": payload.get("filename"),
            "reason": reason.strip(),
            "automatic_adjustment_count": payload.get("adjustment_count", 0),
            "deleted_count": len(replaceable),
            "deleted_ids": old_ids,
            "old_quantity": old_quantity,
            "created_count": len(rows),
            "new_quantity": new_quantity,
            "preserved_count": preserved_count,
            "preserved_quantity": preserved_quantity,
            "restored_waybill_rows": restore_result.restored_rows,
            "restored_waybill_quantity": restore_result.restored_quantity,
            "unresolved_waybill_rows": restore_result.unresolved_rows,
            "restored_adjustment_count": restore_result.restored_adjustments,
            "restored_deferral_count": restore_result.restored_deferrals,
        },
    )
    db.commit()
    pop_history_import_session(import_session_id)
    return ShippingPlanImportCommitOut(
        issue_id=issue.id,
        issue_number=issue.issue_number,
        deleted_count=len(replaceable),
        created_count=len(rows),
        preserved_count=preserved_count,
        resulting_quantity=new_quantity + preserved_quantity,
        restored_waybill_rows=restore_result.restored_rows,
        restored_waybill_quantity=restore_result.restored_quantity,
        unresolved_waybill_rows=restore_result.unresolved_rows,
        restored_adjustment_count=restore_result.restored_adjustments,
        restored_deferral_count=restore_result.restored_deferrals,
    )
