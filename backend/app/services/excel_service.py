import io
import os
from datetime import date
from openpyxl import load_workbook, Workbook
from sqlalchemy.orm import Session
from app.models import Issue, ReportEntry, ReportItemTemplate, ShippingRecord, Recipient

TEMPLATE_DIR = os.path.join(os.path.dirname(__file__), "..", "templates")


def _get_template_path(filename: str) -> str:
    path = os.path.join(TEMPLATE_DIR, filename)
    if os.path.exists(path):
        return path
    return None


def export_report_excel(issue_id: int, db: Session) -> io.BytesIO:
    """Generate the 报数 Excel file for a given issue."""
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise ValueError("Issue not found")

    template_path = _get_template_path("report_template.xlsx")

    if template_path:
        wb = load_workbook(template_path)
    else:
        wb = Workbook()
        wb.active.title = "北京印厂印数表"

    # Get all entries with their template mappings
    entries = db.query(ReportEntry).filter(ReportEntry.issue_id == issue_id).all()
    templates = {
        (t.category, t.sub_category): t
        for t in db.query(ReportItemTemplate).all()
    }

    # Write data to mapped cells
    for entry in entries:
        tmpl = templates.get((entry.category, entry.sub_category))
        if tmpl and tmpl.excel_sheet and tmpl.excel_cell:
            if tmpl.excel_sheet in wb.sheetnames:
                ws = wb[tmpl.excel_sheet]
                ws[tmpl.excel_cell] = entry.value

    # Save to BytesIO
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    return output


def export_shipping_excel(issue_id: int, db: Session) -> io.BytesIO:
    """Generate the 中通发货明细 Excel file for a given issue."""
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise ValueError("Issue not found")

    template_path = _get_template_path("shipping_template.xlsx")

    if template_path:
        wb = load_workbook(template_path)
    else:
        wb = Workbook()

    # Get shipping records with recipient info
    records = (
        db.query(ShippingRecord, Recipient)
        .join(Recipient, ShippingRecord.recipient_id == Recipient.id)
        .filter(ShippingRecord.issue_id == issue_id)
        .all()
    )

    # Group by recipient type for different sheets
    corporate = [(r, rec) for r, rec in records if rec.type.value == "corporate"]
    readers = [(r, rec) for r, rec in records if rec.type.value == "reader"]
    samples = [(r, rec) for r, rec in records if rec.type.value == "sample"]

    def _write_sheet(ws, items, start_row=2):
        for i, (record, recipient) in enumerate(items):
            row = start_row + i
            ws.cell(row=row, column=1, value=i + 1)
            ws.cell(row=row, column=2, value=recipient.name)
            ws.cell(row=row, column=3, value=recipient.phone or "")
            ws.cell(row=row, column=4, value=recipient.address or "")
            ws.cell(row=row, column=5, value=record.quantity)

    # Write to sheets (create if template doesn't have them)
    sheet_names = ["每周合计", "每周（对公）", "每周（读者）", "样报缴送清单"]
    sheet_data = [corporate + readers + samples, corporate, readers, samples]

    for name, data in zip(sheet_names, sheet_data):
        if name in wb.sheetnames:
            ws = wb[name]
        else:
            ws = wb.create_sheet(name)
            ws.append(["序号", "收件人", "电话", "地址", "份数"])
        _write_sheet(ws, data)

    # Remove default "Sheet" if it exists and we created other sheets
    if "Sheet" in wb.sheetnames and len(wb.sheetnames) > 1:
        del wb["Sheet"]

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    return output


def get_report_filename(issue: Issue) -> str:
    year = issue.publish_date.year
    return f"{year}年《中国经营报》（总第{issue.issue_number}期）报数.xlsx"


def get_shipping_filename(issue: Issue) -> str:
    d = issue.publish_date
    return f"{d.year}年{d.month}月{d.day}日《中国经营报》中通快递发货明细（{issue.issue_number}）.xlsx"
