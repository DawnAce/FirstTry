"""Parse uploaded history report/shipping workbooks and produce a preview + commit."""

import datetime
import re

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.history_import_cache import save_history_import_session, pop_history_import_session
from app.models import Issue, IssueStatus, PublicationSchedule, ReportEntry, ReportItemTemplate, ShippingDetail, TempPrintDetail
from app.services.original_zto_shipping_import_service import (
    is_original_zto_shipping_workbook,
    normalize_shipping_sub_channels,
    read_original_zto_shipping_basic_info,
    read_original_zto_shipping_rows_with_warnings,
)
from app.services.raw_report_import_service import parse_raw_report_workbook
from app.services.report_destination_service import DESTINATION_ZTO, resolve_report_destination
from app.services.workbook_loader import load_uploaded_workbook
from app.schemas.history_import import (
    CommitReadiness,
    HistoryImportCommitOut,
    HistoryImportRow,
    ManualReportMapping,
    ReportMappingOption,
    TempPrintDetailRow,
    ShippingImportRow,
    HistoryImportPreviewOut,
    UnmappedReportItem,
)

_SHIPPING_COLUMNS = [
    "工作表名称", "渠道", "子渠道", "运输方式", "频次", "状态",
    "姓名", "地址", "电话", "数量", "截止日期", "备注", "附加信息",
    "网点名称", "网点大厅", "联系人", "序号", "期数", "公司",
]

_REPORT_TOTAL_EXCLUDED_SUB_CATEGORIES = {
    "临时加印_自留",
    "营报传媒加印",
    "财经中心加印",
    "中经未来",
    "产经中心加印",
}


def _normalize_date(value: object) -> str:
    """Return an ISO YYYY-MM-DD string from an Excel cell value (datetime, date, or string)."""
    if isinstance(value, datetime.datetime):
        return value.date().isoformat()
    if isinstance(value, datetime.date):
        return value.isoformat()
    if value is None:
        return ""
    return str(value).strip()


def _parse_issue_number(value: object) -> int | None:
    if value is None:
        return None
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _parse_issue_number_from_filename(filename: str | None) -> int | None:
    if not filename:
        return None
    matches = re.findall(
        r"第\s*(\d+)\s*期|[（(]\s*(\d+)\s*[）)]",
        filename,
    )
    issue_numbers = {
        int(value)
        for groups in matches
        for value in groups
        if value
    }
    return next(iter(issue_numbers)) if len(issue_numbers) == 1 else None


def _is_iso_date(value: str) -> bool:
    if not value:
        return False
    try:
        datetime.date.fromisoformat(value)
        return True
    except ValueError:
        return False


def _read_basic_info(wb) -> dict:
    """Return a key→value dict from the 基本信息 sheet (skipping the header row)."""
    sheet = wb["基本信息"]
    result: dict = {}
    for row in sheet.iter_rows(min_row=2, values_only=True):
        key, value = (row[0] if len(row) > 0 else None), (row[1] if len(row) > 1 else None)
        if key:
            result[str(key)] = value
    return result


def _read_report_rows(wb) -> list[HistoryImportRow]:
    sheet = wb["报数项"]
    rows: list[HistoryImportRow] = []
    for row in sheet.iter_rows(min_row=2, values_only=True):
        if not any(row):
            continue
        cat_code, _cat_name, item, dest, is_var, value = (
            row[0] or "", row[1] or "", row[2] or "", row[3] or "",
            row[4], row[5],
        )
        rows.append(HistoryImportRow(
            category=str(cat_code),
            display_name="",        # enriched later from template
            sub_category=str(item),
            destination=str(dest),
            is_variable=(str(is_var).strip() == "是"),
            value=int(value) if value is not None else 0,
        ))
    return rows


def _read_temp_rows(wb) -> list[TempPrintDetailRow]:
    sheet = wb["临时加印明细"]
    rows: list[TempPrintDetailRow] = []
    for row in sheet.iter_rows(min_row=2, values_only=True):
        if not any(row):
            continue
        dept, custom, qty, self_qty = (
            row[0] or "", row[1] or "",
            row[2] if row[2] is not None else 0,
            row[3] if row[3] is not None else 0,
        )
        rows.append(TempPrintDetailRow(
            department=str(dept),
            custom_name=str(custom),
            quantity=int(qty),
            self_quantity=int(self_qty),
        ))
    return rows


def _is_template_report_workbook(wb) -> bool:
    return {"基本信息", "报数项", "临时加印明细"}.issubset(set(wb.sheetnames))


def _is_template_shipping_workbook(wb) -> bool:
    return {"基本信息", "发货明细"}.issubset(set(wb.sheetnames))


def _read_shipping_rows(wb) -> list[ShippingImportRow]:
    sheet = wb["发货明细"]
    rows: list[ShippingImportRow] = []
    for row in sheet.iter_rows(min_row=2, values_only=True):
        if not any(row):
            continue
        def _str(v: object) -> str:
            return str(v) if v is not None else ""
        def _int_or_none(v: object) -> int | None:
            return int(v) if v is not None else None
        rows.append(ShippingImportRow(
            sheet_name=_str(row[0]),
            channel=_str(row[1]),
            sub_channel=_str(row[2]),
            transport=_str(row[3]),
            frequency=_str(row[4]),
            status=_str(row[5]),
            name=_str(row[6]),
            address=_str(row[7]),
            phone=_str(row[8]),
            quantity=int(row[9]) if row[9] is not None else 0,
            deadline=_str(row[10]),
            notes=_str(row[11]),
            extra_info=_str(row[12]),
            station_name=_str(row[13]),
            station_hall=_str(row[14]),
            contact_person=_str(row[15]),
            seq_number=_int_or_none(row[16]),
            period_count=_int_or_none(row[17]),
            company=_str(row[18]),
        ))
    return rows


def _validate_and_enrich_report_rows(
    db: Session,
    rows: list[HistoryImportRow],
) -> tuple[list[str], list[HistoryImportRow]]:
    """Validate rows against templates and enrich each with display_name from the template.

    Returns (errors, enriched_rows). When no templates are seeded, validation is skipped
    and rows are returned with empty display_name (preserves existing behavior).
    """
    templates = db.query(ReportItemTemplate).all()
    if not templates:
        return [], rows
    template_map = {(t.category, t.sub_category): t for t in templates}
    errors: list[str] = []
    enriched: list[HistoryImportRow] = []
    for row in rows:
        key = (row.category, row.sub_category)
        if key not in template_map:
            errors.append(
                f"报数项行不在模板定义中：分类编码={row.category!r}，项目名称={row.sub_category!r}"
            )
        else:
            enriched.append(row.model_copy(update={"display_name": template_map[key].display_name}))
    return errors, enriched


def _error_response(
    issue_number: int,
    publish_date: str,
    readiness: CommitReadiness,
    shipping_issue_source: str = "",
    warnings: list[str] | None = None,
) -> HistoryImportPreviewOut:
    return HistoryImportPreviewOut(
        issue_number=issue_number,
        shipping_issue_source=shipping_issue_source,
        publish_date=publish_date,
        report_entry_count=0,
        temp_detail_count=0,
        shipping_detail_count=0,
        can_commit=False,
        import_session_id="",
        errors=readiness.errors,
        warnings=warnings or [],
        readiness=readiness,
    )


def _raw_report_validation_result(raw_report) -> tuple[list[str], int, int]:
    errors: list[str] = []
    row_map = {(row.category, row.sub_category): row.value for row in raw_report.report_rows}
    temp_total = row_map.get(("social_use", "临时加印"), 0)
    temp_self = row_map.get(("social_use", "临时加印_自留"), 0)
    pending_temp = max(temp_total - temp_self, 0)
    if temp_self > temp_total:
        errors.append(
            f"临时加印自留分发 {temp_self} 份不能大于加印总数 {temp_total} 份"
        )
    unresolved_total = sum(item.value for item in raw_report.unmapped_rows)
    projected_total = raw_report.mapped_total + unresolved_total
    if not raw_report.unmapped_rows and raw_report.source_total != raw_report.mapped_total:
        diff = abs(raw_report.source_total - raw_report.mapped_total)
        errors.append(
            f"原表总印数 {raw_report.source_total} 与映射后总数 {raw_report.mapped_total} 不一致，相差 {diff} 份"
        )
    elif raw_report.source_total != projected_total:
        diff = abs(raw_report.source_total - projected_total)
        errors.append(
            f"原表总印数 {raw_report.source_total} 与已识别及待归类合计 {projected_total} 不一致，相差 {diff} 份"
        )
    return errors, pending_temp, temp_self


def _report_mapping_options(db: Session) -> list[ReportMappingOption]:
    templates = db.query(ReportItemTemplate).order_by(ReportItemTemplate.sort_order, ReportItemTemplate.id).all()
    return [
        ReportMappingOption(
            category=template.category,
            sub_category=template.sub_category,
            display_name=template.display_name,
        )
        for template in templates
    ]


def _zto_total_validation_errors(
    report_rows: list[HistoryImportRow],
    shipping_rows: list[ShippingImportRow],
) -> list[str]:
    report_total = sum(
        row.value or 0
        for row in report_rows
        if row.sub_category not in _REPORT_TOTAL_EXCLUDED_SUB_CATEGORIES
        and resolve_report_destination(row.category, row.sub_category, row.destination) == DESTINATION_ZTO
    )
    if report_total == 0:
        return []
    shipping_total = sum(row.quantity or 0 for row in shipping_rows)
    if report_total == shipping_total:
        return []
    diff = abs(report_total - shipping_total)
    return [
        f"中通物流份数不一致：报数合计 {report_total} 份，发货明细合计 {shipping_total} 份，相差 {diff} 份。请先核对导入文件后再提交。"
    ]


def preview_history_import(
    db: Session,
    report_bytes: bytes,
    shipping_bytes: bytes,
    report_password: str | None = None,
    shipping_filename: str | None = None,
) -> HistoryImportPreviewOut:
    report_wb = load_uploaded_workbook(
        report_bytes,
        password=report_password,
        file_label="印数文件",
    )
    shipping_wb = load_uploaded_workbook(
        shipping_bytes,
        file_label="中通发货文件",
    )

    uses_template_report = _is_template_report_workbook(report_wb)
    uses_template_shipping = _is_template_shipping_workbook(shipping_wb)
    uses_original_zto_shipping = is_original_zto_shipping_workbook(shipping_wb)
    raw_report = None if uses_template_report else parse_raw_report_workbook(report_wb)
    report_basic = _read_basic_info(report_wb) if uses_template_report else {
        "期号": raw_report.issue_number,
        "出版日期": raw_report.publish_date,
        "版数": raw_report.page_count,
        "备注": "",
    }
    if uses_template_shipping:
        shipping_basic = _read_basic_info(shipping_wb)
        shipping_basic["期号来源"] = "基本信息（期号字段）"
        shipping_basic["期号错误"] = []
    elif uses_original_zto_shipping:
        shipping_basic = read_original_zto_shipping_basic_info(shipping_wb)
    else:
        report_issue_raw = report_basic.get("期号")
        report_issue_number = _parse_issue_number(report_issue_raw) or 0
        readiness = CommitReadiness(
            same_issue=False,
            issue_exists=False,
            can_commit=False,
            errors=["中通发货文件格式不支持，请上传系统发货明细模板或原始中通多工作表文件"],
        )
        return _error_response(
            report_issue_number,
            _normalize_date(report_basic.get("出版日期")),
            readiness,
        )

    report_issue_raw = report_basic.get("期号")
    shipping_issue_raw = shipping_basic.get("期号")
    report_issue_number = _parse_issue_number(report_issue_raw)
    shipping_issue_number = _parse_issue_number(shipping_issue_raw)
    shipping_issue_source = str(shipping_basic.get("期号来源") or "")
    shipping_issue_errors = [str(error) for error in shipping_basic.get("期号错误", [])]
    publish_date = _normalize_date(report_basic.get("出版日期"))
    shipping_identity_warnings: list[str] = []
    filename_issue_number = _parse_issue_number_from_filename(shipping_filename)
    if (
        filename_issue_number is not None
        and shipping_issue_number is not None
        and filename_issue_number != shipping_issue_number
    ):
        shipping_identity_warnings.append(
            f"中通发货文件名显示第 {filename_issue_number} 期，但工作簿主期号为第 {shipping_issue_number} 期"
            f"（来源：{shipping_issue_source or '工作簿内容'}）。系统以工作簿为准，请确认文件名。"
        )

    if report_issue_number is None:
        readiness = CommitReadiness(
            same_issue=False,
            issue_exists=False,
            can_commit=False,
            errors=["报数模板中的期号格式无效，请填写纯数字期号"],
        )
        return _error_response(
            0,
            publish_date,
            readiness,
            shipping_issue_source,
            shipping_identity_warnings,
        )

    if shipping_issue_errors:
        readiness = CommitReadiness(
            same_issue=False,
            issue_exists=False,
            can_commit=False,
            errors=shipping_issue_errors,
        )
        return _error_response(
            report_issue_number,
            publish_date,
            readiness,
            shipping_issue_source,
            shipping_identity_warnings,
        )

    if shipping_issue_number is None:
        readiness = CommitReadiness(
            same_issue=False,
            issue_exists=False,
            can_commit=False,
            errors=["中通模板中的期号格式无效，请填写纯数字期号"],
        )
        return _error_response(
            report_issue_number,
            publish_date,
            readiness,
            shipping_issue_source,
            shipping_identity_warnings,
        )

    if not _is_iso_date(publish_date):
        readiness = CommitReadiness(
            same_issue=True,
            issue_exists=False,
            can_commit=False,
            errors=["出版日期不能为空，且必须为 YYYY-MM-DD 格式"],
        )
        return _error_response(
            report_issue_number,
            publish_date,
            readiness,
            shipping_issue_source,
            shipping_identity_warnings,
        )

    # Validate cross-issue upload
    if report_issue_number != shipping_issue_number:
        readiness = CommitReadiness(
            same_issue=False,
            issue_exists=False,
            can_commit=False,
            errors=[f"两份文件不是同一期：报数文件为 {report_issue_number} 期，发货文件为 {shipping_issue_number} 期"],
        )
        return _error_response(
            report_issue_number,
            publish_date,
            readiness,
            shipping_issue_source,
            shipping_identity_warnings,
        )

    issue_number = report_issue_number
    page_count = int(report_basic.get("版数", 24) or 24)
    notes = str(report_basic.get("备注", "") or "")

    # Block duplicate import
    existing = db.query(Issue).filter(Issue.issue_number == issue_number).first()
    if existing is not None:
        readiness = CommitReadiness(
            same_issue=True,
            issue_exists=True,
            can_commit=False,
            errors=[f"该期已存在：第 {issue_number} 期已录入系统，无法重复导入"],
        )
        return _error_response(
            issue_number,
            publish_date,
            readiness,
            shipping_issue_source,
            shipping_identity_warnings,
        )

    if raw_report is None:
        report_rows = _read_report_rows(report_wb)
        temp_rows = _read_temp_rows(report_wb)
    else:
        report_rows = raw_report.report_rows
        temp_rows = []
    shipping_import_warnings: list[str] = []
    if uses_template_shipping:
        shipping_rows, shipping_import_warnings = normalize_shipping_sub_channels(
            _read_shipping_rows(shipping_wb)
        )
    else:
        shipping_rows, shipping_import_warnings = read_original_zto_shipping_rows_with_warnings(shipping_wb)

    manual_temp_print_required_quantity = 0
    manual_temp_print_self_quantity = 0
    manual_temp_rows: list[TempPrintDetailRow] = []
    validation_errors: list[str] = []
    unmapped_report_items: list[UnmappedReportItem] = []
    source_total = sum(row.value for row in report_rows)
    mapped_total = source_total
    if raw_report is not None:
        (
            raw_validation_errors,
            manual_temp_print_required_quantity,
            manual_temp_print_self_quantity,
        ) = _raw_report_validation_result(raw_report)
        validation_errors.extend(raw_validation_errors)
        manual_temp_rows = raw_report.temp_print_rows
        source_total = raw_report.source_total
        mapped_total = raw_report.mapped_total
        unmapped_report_items = [UnmappedReportItem(**item.__dict__) for item in raw_report.unmapped_rows]

    # Validate report rows against template structure and enrich with display_name
    template_validation_errors, enriched_report_rows = _validate_and_enrich_report_rows(db, report_rows)
    validation_errors.extend(template_validation_errors)

    if not validation_errors and not unmapped_report_items:
        validation_errors.extend(_zto_total_validation_errors(enriched_report_rows, shipping_rows))

    payload: dict = {
        "issue_number": issue_number,
        "publish_date": publish_date,
        "page_count": page_count,
        "notes": notes,
        "report_rows": [r.model_dump() for r in enriched_report_rows],
        "temp_rows": [r.model_dump() for r in temp_rows],
        "shipping_rows": [r.model_dump() for r in shipping_rows],
        "manual_temp_print_required_quantity": manual_temp_print_required_quantity,
        "manual_temp_print_self_quantity": manual_temp_print_self_quantity,
        "manual_temp_rows": [r.model_dump() for r in manual_temp_rows],
        "source_total": source_total,
        "unmapped_report_items": [item.model_dump() for item in unmapped_report_items],
    }
    session_id = save_history_import_session(payload) if not validation_errors else ""

    # Compare against publication_schedule.page_count, warn on mismatch
    warnings: list[str] = [*shipping_identity_warnings, *shipping_import_warnings]
    schedule_row = _find_schedule_row(db, issue_number, publish_date)
    if schedule_row is not None and schedule_row.page_count is not None and schedule_row.page_count != page_count:
        warnings.append(
            f"印数表实际版数为 {page_count} 版，与刊期计划的 {schedule_row.page_count} 版不同。"
            f"导入后将分别保留：实际版数 {page_count} 版，计划版数仍为 {schedule_row.page_count} 版。"
        )

    readiness = CommitReadiness(
        same_issue=True,
        issue_exists=False,
        can_commit=not validation_errors,
        errors=validation_errors,
    )
    can_commit = (
        not validation_errors
        and not unmapped_report_items
        and manual_temp_print_required_quantity == 0
    )
    return HistoryImportPreviewOut(
        issue_number=issue_number,
        shipping_issue_source=shipping_issue_source,
        publish_date=publish_date,
        page_count=page_count,
        report_entry_count=len(enriched_report_rows),
        temp_detail_count=len(temp_rows),
        shipping_detail_count=len(shipping_rows),
        can_commit=can_commit,
        import_session_id=session_id,
        errors=validation_errors,
        warnings=warnings,
        readiness=readiness,
        manual_temp_print_required_quantity=manual_temp_print_required_quantity,
        manual_temp_print_self_quantity=manual_temp_print_self_quantity,
        manual_temp_rows=manual_temp_rows,
        report_rows=enriched_report_rows,
        source_total=source_total,
        mapped_total=mapped_total,
        unmapped_report_items=unmapped_report_items,
        report_mapping_options=_report_mapping_options(db),
    )


def _find_schedule_row(
    db: Session,
    issue_number: int,
    publish_date_str: str,
) -> PublicationSchedule | None:
    """Locate the schedule row for this import. Prefer issue_number, fall back to publish_date."""
    row = db.query(PublicationSchedule).filter(
        PublicationSchedule.issue_number == issue_number,
    ).first()
    if row is not None:
        return row
    try:
        from datetime import date as _date
        publish_date = _date.fromisoformat(publish_date_str)
    except ValueError:
        return None
    return db.query(PublicationSchedule).filter(
        PublicationSchedule.publish_date == publish_date,
    ).first()


def _validate_manual_temp_rows(
    required_quantity: int,
    rows: list[TempPrintDetailRow] | None,
) -> list[dict]:
    if required_quantity <= 0:
        return [] if rows is None else [row.model_dump() for row in rows]
    if not rows:
        raise HTTPException(
            status_code=422,
            detail=f"临时加印需要补充分配明细，合计应为 {required_quantity} 份",
        )
    total = sum(row.quantity for row in rows)
    if total != required_quantity:
        raise HTTPException(
            status_code=422,
            detail=f"临时加印明细合计 {total} 份，应等于待手工确认 {required_quantity} 份",
        )
    for row in rows:
        if row.quantity < 0 or row.self_quantity < 0:
            raise HTTPException(status_code=422, detail="临时加印明细数量不能为负数")
        if row.self_quantity > row.quantity:
            raise HTTPException(status_code=422, detail="临时加印明细自留分发数量不能大于加印数量")
    return [row.model_dump() for row in rows]


def _apply_manual_report_mappings(
    db: Session,
    payload: dict,
    mappings: list[ManualReportMapping] | None,
) -> list[dict]:
    unresolved = {
        item["item_id"]: item
        for item in payload.get("unmapped_report_items", [])
    }
    if not unresolved:
        return list(payload.get("report_rows", []))

    supplied = mappings or []
    supplied_by_id = {mapping.item_id: mapping for mapping in supplied}
    if len(supplied_by_id) != len(supplied):
        raise HTTPException(status_code=422, detail="待归类项目不能重复提交")
    missing_ids = set(unresolved) - set(supplied_by_id)
    extra_ids = set(supplied_by_id) - set(unresolved)
    if missing_ids:
        raise HTTPException(status_code=422, detail=f"还有 {len(missing_ids)} 个项目未完成归类")
    if extra_ids:
        raise HTTPException(status_code=422, detail="提交了无效的待归类项目")

    templates = db.query(ReportItemTemplate).all()
    template_map = {(template.category, template.sub_category): template for template in templates}
    rows_by_key = {
        (row["category"], row["sub_category"]): dict(row)
        for row in payload.get("report_rows", [])
    }
    for item_id, mapping in supplied_by_id.items():
        key = (mapping.category, mapping.sub_category)
        template = template_map.get(key)
        if template is None:
            raise HTTPException(status_code=422, detail="所选报数归类已失效，请重新预览")
        quantity = int(unresolved[item_id]["value"] or 0)
        if key in rows_by_key:
            rows_by_key[key]["value"] = int(rows_by_key[key].get("value", 0) or 0) + quantity
        else:
            rows_by_key[key] = HistoryImportRow(
                category=template.category,
                display_name=template.display_name,
                sub_category=template.sub_category,
                destination=template.destination or "",
                is_variable=template.is_variable,
                value=quantity,
            ).model_dump()

    rows = list(rows_by_key.values())
    source_total = int(payload.get("source_total", 0) or 0)
    mapped_total = sum(int(row.get("value", 0) or 0) for row in rows)
    if source_total and mapped_total != source_total:
        raise HTTPException(
            status_code=422,
            detail=f"归类后总数 {mapped_total} 份，与原表总印数 {source_total} 份不一致",
        )
    shipping_rows = [ShippingImportRow(**row) for row in payload.get("shipping_rows", [])]
    zto_errors = _zto_total_validation_errors([HistoryImportRow(**row) for row in rows], shipping_rows)
    if zto_errors:
        raise HTTPException(status_code=422, detail=zto_errors[0])
    return rows


def commit_history_import(
    db: Session,
    import_session_id: str,
    manual_temp_rows: list[TempPrintDetailRow] | None = None,
    manual_report_mappings: list[ManualReportMapping] | None = None,
) -> HistoryImportCommitOut:
    """Persist a previously previewed history import from cache to the database.

    Raises:
        HTTPException 400: session missing or expired.
        HTTPException 409: issue_number already exists in the database.
    """
    payload = pop_history_import_session(import_session_id)
    if payload is None:
        raise HTTPException(
            status_code=400,
            detail=f"导入会话不存在或已过期：{import_session_id}",
        )

    issue_number: int = payload["issue_number"]
    existing = db.query(Issue).filter(Issue.issue_number == issue_number).first()
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail=f"该期已存在：第 {issue_number} 期已录入系统，无法重复导入",
        )

    payload["report_rows"] = _apply_manual_report_mappings(db, payload, manual_report_mappings)

    required_temp_quantity = int(payload.get("manual_temp_print_required_quantity", 0) or 0)
    if required_temp_quantity > 0 or manual_temp_rows is not None:
        payload["temp_rows"] = _validate_manual_temp_rows(required_temp_quantity, manual_temp_rows)

    from datetime import date as _date
    publish_date_str: str = payload["publish_date"]
    publish_date = _date.fromisoformat(publish_date_str)

    issue = Issue(
        issue_number=issue_number,
        publish_date=publish_date,
        page_count=payload.get("page_count", 24),
        notes=payload.get("notes", ""),
        status=IssueStatus.draft,
    )
    db.add(issue)
    db.flush()  # populate issue.id without committing

    for row in payload.get("report_rows", []):
        db.add(ReportEntry(
            issue_id=issue.id,
            category=row["category"],
            sub_category=row["sub_category"],
            destination=row.get("destination", ""),
            value=row.get("value", 0),
            is_variable=row.get("is_variable", False),
        ))

    for row in payload.get("temp_rows", []):
        db.add(TempPrintDetail(
            issue_id=issue.id,
            department=row.get("department", ""),
            custom_name=row.get("custom_name", ""),
            quantity=row.get("quantity", 0),
            self_quantity=row.get("self_quantity", 0),
        ))

    for row in payload.get("shipping_rows", []):
        db.add(ShippingDetail(
            issue_number=issue_number,
            sheet_name=row.get("sheet_name", ""),
            channel=row.get("channel", ""),
            sub_channel=row.get("sub_channel", ""),
            transport=row.get("transport", ""),
            frequency=row.get("frequency", ""),
            status=row.get("status", ""),
            name=row.get("name", ""),
            address=row.get("address", ""),
            phone=row.get("phone", ""),
            quantity=row.get("quantity", 0),
            deadline=row.get("deadline", ""),
            notes=row.get("notes", ""),
            extra_info=row.get("extra_info", ""),
            station_name=row.get("station_name", ""),
            station_hall=row.get("station_hall", ""),
            contact_person=row.get("contact_person", ""),
            seq_number=row.get("seq_number"),
            period_count=row.get("period_count"),
            confirmation=row.get("confirmation", ""),
            company=row.get("company", ""),
        ))

    db.commit()
    db.refresh(issue)

    return HistoryImportCommitOut(
        issue_id=issue.id,
        issue_number=issue.issue_number,
        report_entry_count=len(payload.get("report_rows", [])),
        temp_detail_count=len(payload.get("temp_rows", [])),
        shipping_detail_count=len(payload.get("shipping_rows", [])),
        # Kept for API compatibility.  Planned page count and actual page
        # count are separate business facts; importing actuals must never
        # rewrite the publication plan.
        schedule_page_count_updated=False,
        previous_schedule_page_count=None,
        new_page_count=issue.page_count,
    )
