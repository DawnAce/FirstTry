"""Parse original multi-sheet ZTO shipping workbooks into history import rows."""

import datetime
import re
from typing import Any, Callable

from app.schemas.history_import import ShippingImportRow

_KNOWN_SHEETS = {
    "每周（对公）",
    "每周（读者）",
    "高铁展示",
    "北京悦途出行（高铁）",
    "上犹",
    "停发-双周（读者）",
    "月底-整月",
}


def _str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _int(value: Any) -> int:
    if value is None or value == "":
        return 0
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def _deadline_str(value: Any) -> str:
    if isinstance(value, datetime.datetime):
        return value.date().isoformat()
    if isinstance(value, datetime.date):
        return value.isoformat()
    return _str(value)


def _is_summary_row(phone_value: Any) -> bool:
    return _str(phone_value) == "合计"


def _is_blank_row(row: tuple[Any, ...]) -> bool:
    return not any(_str(value) for value in row)


def _workbook_text_values(wb) -> list[str]:
    values: list[str] = []
    for ws in wb.worksheets:
        for row in ws.iter_rows(min_row=1, max_row=min(ws.max_row, 3), values_only=True):
            for value in row:
                text = _str(value)
                if text:
                    values.append(text)
    return values


def _extract_issue_number(wb) -> int | None:
    issue_numbers: list[int] = []
    for text in _workbook_text_values(wb):
        issue_numbers.extend(int(value) for value in re.findall(r"第\s*(\d+)\s*期", text))
    return max(issue_numbers) if issue_numbers else None


def _extract_publish_date(wb) -> str:
    for text in _workbook_text_values(wb):
        match = re.search(r"(\d{4})年(\d{1,2})月(\d{1,2})日", text)
        if match:
            year, month, day = (int(part) for part in match.groups())
            return datetime.date(year, month, day).isoformat()
    return ""


def is_original_zto_shipping_workbook(wb) -> bool:
    sheet_names = set(wb.sheetnames)
    return bool(sheet_names & _KNOWN_SHEETS) and not {"基本信息", "发货明细"}.issubset(sheet_names)


def read_original_zto_shipping_basic_info(wb) -> dict:
    return {
        "期号": _extract_issue_number(wb),
        "出版日期": _extract_publish_date(wb),
    }


def _row_to_import_row(sheet_name: str, row: dict[str, Any]) -> ShippingImportRow:
    return ShippingImportRow(
        sheet_name=sheet_name,
        channel=_str(row.get("channel")),
        sub_channel=_str(row.get("sub_channel")),
        transport=_str(row.get("transport")),
        frequency=_str(row.get("frequency")),
        status=_str(row.get("status") or "正常"),
        name=_str(row.get("name")) or "(未填写)",
        address=_str(row.get("address")),
        phone=_str(row.get("phone")),
        quantity=_int(row.get("quantity")),
        deadline=_deadline_str(row.get("deadline")),
        notes=_str(row.get("notes")),
        extra_info=_str(row.get("extra_info")),
        station_name=_str(row.get("station_name")),
        station_hall=_str(row.get("station_hall")),
        contact_person=_str(row.get("contact_person")),
        seq_number=_int(row.get("seq_number")) if row.get("seq_number") not in (None, "") else None,
        period_count=_int(row.get("period_count")) if row.get("period_count") not in (None, "") else None,
        confirmation=_str(row.get("confirmation")),
        company=_str(row.get("company")),
    )


def _parse_table_sheet(ws, sheet_name: str, min_row: int, max_col: int) -> list[ShippingImportRow]:
    rows: list[ShippingImportRow] = []
    for row in ws.iter_rows(min_row=min_row, max_col=max_col, values_only=True):
        if _is_blank_row(row) or _is_summary_row(row[2]):
            continue
        name, address, phone, quantity, _publication, channel, sub_channel, company, frequency, transport, _city, notes, *rest = row
        rows.append(_row_to_import_row(
            sheet_name,
            {
                "name": name,
                "address": address,
                "phone": phone,
                "quantity": quantity,
                "channel": channel,
                "sub_channel": sub_channel,
                "company": company,
                "frequency": frequency,
                "transport": transport,
                "notes": notes,
                "extra_info": rest[0] if rest else "",
            },
        ))
    return rows


def _parse_weekly_reader(ws) -> list[ShippingImportRow]:
    rows: list[ShippingImportRow] = []
    for row in ws.iter_rows(min_row=3, max_col=14, values_only=True):
        if _is_blank_row(row) or _is_summary_row(row[2]):
            continue
        name, address, phone, quantity, _publication, deadline, channel, sub_channel, company, frequency, transport, _city, notes, extra = row
        rows.append(_row_to_import_row(
            "每周（读者）",
            {
                "name": name,
                "address": address,
                "phone": phone,
                "quantity": quantity,
                "deadline": deadline,
                "channel": channel,
                "sub_channel": sub_channel,
                "company": company,
                "frequency": frequency,
                "transport": transport,
                "notes": notes,
                "extra_info": extra,
            },
        ))
    return rows


def _parse_high_speed_rail(ws) -> list[ShippingImportRow]:
    rows: list[ShippingImportRow] = []
    for row in ws.iter_rows(min_row=4, max_col=15, values_only=True):
        if _is_blank_row(row) or (row[1] is None and row[2] is None):
            continue
        _city, seq, station, hall, contact, phone, address, quantity, confirmation, extra, channel, sub_channel, company, frequency, transport = row
        rows.append(_row_to_import_row(
            "高铁展示",
            {
                "channel": channel,
                "sub_channel": sub_channel,
                "transport": transport,
                "company": company,
                "frequency": frequency,
                "status": "正常",
                "name": contact,
                "seq_number": seq,
                "station_name": station,
                "station_hall": hall,
                "contact_person": contact,
                "phone": phone,
                "address": address,
                "quantity": quantity,
                "confirmation": confirmation,
                "extra_info": extra,
            },
        ))
    return rows


def _parse_suspended_biweekly(ws) -> list[ShippingImportRow]:
    rows: list[ShippingImportRow] = []
    for row in ws.iter_rows(min_row=3, max_col=8, values_only=True):
        if _is_blank_row(row) or _is_summary_row(row[2]):
            continue
        name, address, phone, period, quantity, _publication, deadline, notes = row
        rows.append(_row_to_import_row(
            "停发-双周（读者）",
            {
                "channel": "个人订阅",
                "transport": "中通物流",
                "frequency": "半月",
                "status": "停发",
                "name": name,
                "address": address,
                "phone": phone,
                "period_count": period,
                "quantity": quantity,
                "deadline": deadline,
                "notes": notes,
            },
        ))
    return rows


def _parse_monthly(ws) -> list[ShippingImportRow]:
    rows: list[ShippingImportRow] = []
    for row in ws.iter_rows(min_row=3, max_col=15, values_only=True):
        if _is_blank_row(row) or _is_summary_row(row[2]):
            continue
        name, address, phone, period, quantity, _publication, deadline, channel, sub_channel, company, frequency, transport, _city, notes, extra = row
        rows.append(_row_to_import_row(
            "月底-整月",
            {
                "name": name,
                "address": address,
                "phone": phone,
                "period_count": period,
                "quantity": quantity,
                "deadline": deadline,
                "channel": channel,
                "sub_channel": sub_channel,
                "company": company,
                "frequency": frequency,
                "transport": transport,
                "notes": notes,
                "extra_info": extra,
            },
        ))
    return rows


def _parse_weekly_corporate(ws) -> list[ShippingImportRow]:
    rows = _parse_table_sheet(ws, "每周（对公）", 3, 13)
    return [
        row for row in rows
        if not (
            row.quantity == 0
            and row.name == "(未填写)"
            and "加印" in row.notes
        )
    ]


def _parse_shangyou(ws) -> list[ShippingImportRow]:
    return _parse_table_sheet(ws, "上犹", 3, 13)


_SHEET_PARSERS: dict[str, Callable[[Any], list[ShippingImportRow]]] = {
    "每周（对公）": _parse_weekly_corporate,
    "每周（读者）": _parse_weekly_reader,
    "高铁展示": _parse_high_speed_rail,
    "北京悦途出行（高铁）": _parse_high_speed_rail,
    "上犹": _parse_shangyou,
    "停发-双周（读者）": _parse_suspended_biweekly,
    "月底-整月": _parse_monthly,
}


def read_original_zto_shipping_rows(wb) -> list[ShippingImportRow]:
    rows: list[ShippingImportRow] = []
    for sheet_name, parser in _SHEET_PARSERS.items():
        if sheet_name in wb.sheetnames:
            rows.extend(parser(wb[sheet_name]))
    return rows
