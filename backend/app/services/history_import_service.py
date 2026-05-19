"""Parse uploaded history report/shipping workbooks and produce a preview."""

import datetime
import io

from openpyxl import load_workbook
from sqlalchemy.orm import Session

from app.history_import_cache import save_history_import_session
from app.models import Issue, ReportItemTemplate
from app.schemas.history_import import (
    CommitReadiness,
    HistoryImportRow,
    TempPrintDetailRow,
    ShippingImportRow,
    HistoryImportPreviewOut,
)

_SHIPPING_COLUMNS = [
    "工作表名称", "渠道", "子渠道", "运输方式", "频次", "状态",
    "姓名", "地址", "电话", "数量", "截止日期", "备注", "附加信息",
    "城市", "网点名称", "网点大厅", "联系人", "序号", "期数", "公司",
]


def _normalize_date(value: object) -> str:
    """Return an ISO YYYY-MM-DD string from an Excel cell value (datetime, date, or string)."""
    if isinstance(value, datetime.datetime):
        return value.date().isoformat()
    if isinstance(value, datetime.date):
        return value.isoformat()
    if value is None:
        return ""
    return str(value).strip()


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
        cat_code, cat_name, item, dest, is_var, value = (
            row[0] or "", row[1] or "", row[2] or "", row[3] or "",
            row[4], row[5],
        )
        rows.append(HistoryImportRow(
            category=str(cat_code),
            category_name=str(cat_name),
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
            city=_str(row[13]),
            station_name=_str(row[14]),
            station_hall=_str(row[15]),
            contact_person=_str(row[16]),
            seq_number=_int_or_none(row[17]),
            period_count=_int_or_none(row[18]),
            company=_str(row[19]),
        ))
    return rows


def _validate_report_rows(
    db: Session,
    rows: list[HistoryImportRow],
) -> list[str]:
    """Return error messages for rows whose (category, sub_category) is not in any template."""
    templates = db.query(ReportItemTemplate).all()
    if not templates:
        return []  # no templates seeded — skip validation
    valid_keys = {(t.category, t.sub_category) for t in templates}
    errors = []
    for row in rows:
        key = (row.category, row.sub_category)
        if key not in valid_keys:
            errors.append(
                f"报数项行不在模板定义中：分类编码={row.category!r}，项目名称={row.sub_category!r}"
            )
    return errors


def _error_response(
    issue_number: int,
    publish_date: str,
    readiness: CommitReadiness,
) -> HistoryImportPreviewOut:
    return HistoryImportPreviewOut(
        issue_number=issue_number,
        publish_date=publish_date,
        report_entry_count=0,
        temp_detail_count=0,
        shipping_detail_count=0,
        can_commit=False,
        import_session_id="",
        errors=readiness.errors,
        readiness=readiness,
    )


def preview_history_import(
    db: Session,
    report_bytes: bytes,
    shipping_bytes: bytes,
) -> HistoryImportPreviewOut:
    report_wb = load_workbook(io.BytesIO(report_bytes), data_only=True)
    shipping_wb = load_workbook(io.BytesIO(shipping_bytes), data_only=True)

    report_basic = _read_basic_info(report_wb)
    shipping_basic = _read_basic_info(shipping_wb)

    report_issue_raw = report_basic.get("期号")
    shipping_issue_raw = shipping_basic.get("期号")
    publish_date = _normalize_date(report_basic.get("出版日期"))

    # Validate cross-issue upload
    if str(report_issue_raw) != str(shipping_issue_raw):
        readiness = CommitReadiness(
            same_issue=False,
            issue_exists=False,
            can_commit=False,
            errors=[f"两份文件不是同一期：报数文件为 {report_issue_raw} 期，发货文件为 {shipping_issue_raw} 期"],
        )
        return _error_response(
            int(report_issue_raw) if report_issue_raw is not None else 0,
            publish_date,
            readiness,
        )

    issue_number = int(report_issue_raw)  # type: ignore[arg-type]
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
        return _error_response(issue_number, publish_date, readiness)

    report_rows = _read_report_rows(report_wb)
    temp_rows = _read_temp_rows(report_wb)
    shipping_rows = _read_shipping_rows(shipping_wb)

    # Validate report rows against template structure
    validation_errors = _validate_report_rows(db, report_rows)
    if validation_errors:
        readiness = CommitReadiness(
            same_issue=True,
            issue_exists=False,
            can_commit=False,
            errors=validation_errors,
        )
        return _error_response(issue_number, publish_date, readiness)

    payload: dict = {
        "issue_number": issue_number,
        "publish_date": publish_date,
        "page_count": page_count,
        "notes": notes,
        "report_rows": [r.model_dump() for r in report_rows],
        "temp_rows": [r.model_dump() for r in temp_rows],
        "shipping_rows": [r.model_dump() for r in shipping_rows],
    }
    session_id = save_history_import_session(payload)

    readiness = CommitReadiness(
        same_issue=True,
        issue_exists=False,
        can_commit=True,
        errors=[],
    )
    return HistoryImportPreviewOut(
        issue_number=issue_number,
        publish_date=publish_date,
        report_entry_count=len(report_rows),
        temp_detail_count=len(temp_rows),
        shipping_detail_count=len(shipping_rows),
        can_commit=True,
        import_session_id=session_id,
        errors=[],
        readiness=readiness,
    )
