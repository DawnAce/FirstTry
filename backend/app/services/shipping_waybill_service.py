"""运单导入、逐包裹核销和期级待补统计。"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
from io import BytesIO
import re
from typing import Any

from fastapi import HTTPException
from openpyxl import load_workbook
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import (
    Issue,
    IssueAuditSnapshot,
    ShippingDetail,
    ShippingDetailSourceType,
    ShippingPackage,
    ShippingWaybillImportBatch,
    ShippingWaybillImportRow,
    WaybillImportStatus,
    WaybillMatchStatus,
)
from app.models.user import User
from app.schemas.shipping_waybill import FulfillmentSummaryOut
from app.services.operation_log_service import record_operation


@dataclass
class ParsedWaybillRow:
    source_sheet: str
    source_row: int
    carrier: str
    tracking_no: str | None
    recipient_name: str
    phone: str
    address: str
    quantity: int
    no_tracking_required: bool = False
    source_detail_id: int | None = None


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _quantity(value: Any) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def _tracking(value: Any) -> str:
    return re.sub(r"\s+", "", _text(value)).upper()


def _looks_like_tracking(value: Any) -> bool:
    value = _tracking(value)
    return bool(re.fullmatch(r"(?:[A-Z]{1,4})?\d{10,24}", value))


def _carrier_for_tracking(tracking_no: str, fallback: str = "中通") -> str:
    if tracking_no.startswith("SF"):
        return "顺丰"
    if tracking_no.startswith("SC"):
        return "邮政挂号"
    return fallback


def _parse_standard_sheet(ws) -> list[ParsedWaybillRow] | None:
    aliases = {
        "detail_id": {"发货明细id", "明细id", "shippingdetailid"},
        "carrier": {"快递公司", "承运公司", "物流公司"},
        "tracking": {"运单号", "快递单号", "物流单号"},
        "quantity": {"实发份数", "份数", "数量"},
        "name": {"姓名", "收件人", "收件人姓名"},
        "phone": {"电话", "手机号", "收件人电话"},
        "address": {"地址", "收件地址", "收件人地址"},
        "no_tracking": {"无需运单", "无需快递", "无需发货"},
    }
    for header_row in range(1, min(ws.max_row, 10) + 1):
        values = [_text(cell.value).lower().replace(" ", "") for cell in ws[header_row]]
        mapping: dict[str, int] = {}
        for key, names in aliases.items():
            for index, value in enumerate(values):
                if value in names:
                    mapping[key] = index
                    break
        if not {"quantity", "name"}.issubset(mapping) or not ({"tracking", "no_tracking"} & mapping.keys()):
            continue
        parsed: list[ParsedWaybillRow] = []
        for row_number, row in enumerate(
            ws.iter_rows(min_row=header_row + 1, values_only=True), start=header_row + 1
        ):
            name = _text(row[mapping["name"]])
            qty = _quantity(row[mapping["quantity"]])
            tracking = _tracking(row[mapping["tracking"]]) if "tracking" in mapping else ""
            no_tracking_value = _text(row[mapping["no_tracking"]]).lower() if "no_tracking" in mapping else ""
            no_tracking = no_tracking_value in {"是", "true", "1", "无需运单", "无需发货"}
            if not name and not tracking and qty == 0:
                continue
            detail_id = _quantity(row[mapping["detail_id"]]) if "detail_id" in mapping else 0
            carrier = _text(row[mapping["carrier"]]) if "carrier" in mapping else ""
            parsed.append(ParsedWaybillRow(
                source_sheet=ws.title,
                source_row=row_number,
                carrier=carrier or ("无需运单" if no_tracking else _carrier_for_tracking(tracking)),
                tracking_no=tracking or None,
                recipient_name=name,
                phone=_text(row[mapping["phone"]]) if "phone" in mapping else "",
                address=_text(row[mapping["address"]]) if "address" in mapping else "",
                quantity=qty,
                no_tracking_required=no_tracking,
                source_detail_id=detail_id or None,
            ))
        return parsed
    return None


def _parse_known_sheet(ws) -> list[ParsedWaybillRow]:
    rows: list[ParsedWaybillRow] = []
    title = ws.title
    if "备用" in title or "社用" in title:
        for row_number, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
            name, address, phone, qty = (_text(row[i]) if i < len(row) else "" for i in range(4))
            quantity = _quantity(qty)
            if not name or name == "合计" or quantity <= 0:
                continue
            rows.append(ParsedWaybillRow(
                source_sheet=title, source_row=row_number, carrier="无需运单", tracking_no=None,
                recipient_name=name, phone=phone, address=address, quantity=quantity,
                no_tracking_required=True,
            ))
        return rows

    for row_number, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        row = tuple(row)
        tracking_c = _tracking(row[2]) if len(row) > 2 and _looks_like_tracking(row[2]) else ""
        tracking_e = _tracking(row[4]) if len(row) > 4 and _looks_like_tracking(row[4]) else ""
        if "邮政30" in title and tracking_c:
            name, phone, address, qty = _text(row[7]), _text(row[4]), _text(row[6]), _quantity(row[8])
            carrier, tracking = "邮政", tracking_c
        elif ("挂号" in title or "整月" in title) and tracking_c:
            name, phone, address, qty = _text(row[6] or row[3]), _text(row[4]), _text(row[5]), _quantity(row[9])
            carrier, tracking = _carrier_for_tracking(tracking_c), tracking_c
        elif ("挂号" in title or "整月" in title) and tracking_e:
            name, phone, address, qty = _text(row[6]), _text(row[7]), _text(row[5]), _quantity(row[9])
            carrier, tracking = _carrier_for_tracking(tracking_e, "邮政挂号"), tracking_e
        elif tracking_c:
            name, phone, address, qty = _text(row[6]), _text(row[4]), _text(row[5]), _quantity(row[7])
            carrier, tracking = _carrier_for_tracking(tracking_c), tracking_c
        else:
            continue
        if not name or qty <= 0:
            continue
        rows.append(ParsedWaybillRow(
            source_sheet=title, source_row=row_number, carrier=carrier, tracking_no=tracking,
            recipient_name=name, phone=phone, address=address, quantity=qty,
        ))
    return rows


def parse_waybill_workbook(content: bytes) -> list[ParsedWaybillRow]:
    try:
        workbook = load_workbook(BytesIO(content), data_only=True, read_only=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="无法读取运单Excel文件") from exc
    parsed: list[ParsedWaybillRow] = []
    for ws in workbook.worksheets:
        standard = _parse_standard_sheet(ws)
        parsed.extend(standard if standard is not None else _parse_known_sheet(ws))
    if not parsed:
        raise HTTPException(status_code=400, detail="未在文件中识别到有效运单或无需运单记录")
    return parsed


def _normalized(value: str) -> str:
    return re.sub(r"[^0-9a-z\u4e00-\u9fff]", "", (value or "").lower())


def _phone(value: str) -> str:
    return re.sub(r"\D", "", value or "")


def _match_key(name: str, phone: str, address: str) -> tuple[str, str, str]:
    return _normalized(name), _phone(phone), _normalized(address)


def _expected_quantity(db: Session, issue: Issue) -> int:
    snapshot = (
        db.query(IssueAuditSnapshot)
        .filter(IssueAuditSnapshot.issue_id == issue.id, IssueAuditSnapshot.snapshot_type == "confirm")
        .order_by(IssueAuditSnapshot.created_at.desc(), IssueAuditSnapshot.id.desc())
        .first()
    )
    if snapshot:
        return snapshot.report_total
    return int(db.query(func.coalesce(func.sum(ShippingDetail.quantity), 0)).filter(
        ShippingDetail.issue_number == issue.issue_number,
        ShippingDetail.source_type != ShippingDetailSourceType.complaint_makeup,
    ).scalar() or 0)


def _details_for_issue(db: Session, issue_number: int) -> list[ShippingDetail]:
    return db.query(ShippingDetail).filter(
        ShippingDetail.issue_number == issue_number,
        ShippingDetail.source_type != ShippingDetailSourceType.complaint_makeup,
    ).order_by(ShippingDetail.id).all()


def preview_import(
    db: Session,
    issue_id: int,
    filename: str,
    content: bytes,
    user: User,
) -> ShippingWaybillImportBatch:
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="刊期不存在")
    digest = sha256(content).hexdigest()
    existing = db.query(ShippingWaybillImportBatch).filter(
        ShippingWaybillImportBatch.issue_number == issue.issue_number,
        ShippingWaybillImportBatch.file_hash == digest,
    ).first()
    if existing:
        if existing.status == WaybillImportStatus.confirmed.value:
            return existing
        # 预览不是最终记录；明细修正后再次上传同一文件时必须重新匹配。
        db.delete(existing)
        db.flush()

    parsed = parse_waybill_workbook(content)
    details = _details_for_issue(db, issue.issue_number)
    by_id = {detail.id: detail for detail in details}
    full: dict[tuple[str, str, str], list[ShippingDetail]] = defaultdict(list)
    phone_address: dict[tuple[str, str], list[ShippingDetail]] = defaultdict(list)
    name_address: dict[tuple[str, str], list[ShippingDetail]] = defaultdict(list)
    for detail in details:
        name, phone, address = _match_key(detail.name, detail.phone or "", detail.address or "")
        full[(name, phone, address)].append(detail)
        if phone and address:
            phone_address[(phone, address)].append(detail)
        if name and address:
            name_address[(name, address)].append(detail)

    existing_tracking = {
        (package.carrier, package.tracking_no)
        for package in db.query(ShippingPackage).all()
    }
    seen_tracking: set[tuple[str, str]] = set()
    row_results: list[tuple[ParsedWaybillRow, str, str | None, int | None]] = []
    quantities_by_detail: dict[int, int] = defaultdict(int)

    for row in parsed:
        status = WaybillMatchStatus.unmatched.value
        reason: str | None = None
        match: ShippingDetail | None = None
        if row.quantity <= 0 or not row.recipient_name:
            status, reason = WaybillMatchStatus.invalid.value, "姓名或份数无效"
        elif not row.no_tracking_required and not row.tracking_no:
            status, reason = WaybillMatchStatus.invalid.value, "缺少运单号"
        elif row.tracking_no and (row.carrier, row.tracking_no) in seen_tracking:
            status, reason = WaybillMatchStatus.duplicate.value, "文件内运单号重复"
        elif row.tracking_no and (row.carrier, row.tracking_no) in existing_tracking:
            status, reason = WaybillMatchStatus.duplicate.value, "运单号已存在"
        else:
            if row.tracking_no:
                seen_tracking.add((row.carrier, row.tracking_no))
            candidates: list[ShippingDetail] = []
            if row.source_detail_id:
                candidate = by_id.get(row.source_detail_id)
                candidates = [candidate] if candidate else []
                reason = None if candidate else "发货明细ID不属于本期"
            else:
                name, phone, address = _match_key(row.recipient_name, row.phone, row.address)
                candidates = full.get((name, phone, address), [])
                if not candidates and phone and address:
                    candidates = phone_address.get((phone, address), [])
                if not candidates and name and address:
                    candidates = name_address.get((name, address), [])
            if len(candidates) == 1:
                match = candidates[0]
                if row.no_tracking_required and match.packages:
                    match = None
                    status, reason = WaybillMatchStatus.invalid.value, "该明细已有运单，不能改为无需运单"
                else:
                    status = WaybillMatchStatus.matched.value
                    quantities_by_detail[match.id] += row.quantity
            elif len(candidates) > 1:
                status, reason = WaybillMatchStatus.ambiguous.value, "匹配到多条发货明细"
            elif reason is None:
                reason = "未找到对应发货明细"
        row_results.append((row, status, reason, match.id if match else None))

    expected = _expected_quantity(db, issue)
    matched_quantity = sum(row.quantity for row, status, _, _ in row_results if status == WaybillMatchStatus.matched.value)
    current_handled = sum(detail.handled_quantity for detail in details)
    projected_handled = current_handled + matched_quantity
    warning_count = sum(1 for _, status, _, _ in row_results if status != WaybillMatchStatus.matched.value)
    for detail_id, imported_quantity in quantities_by_detail.items():
        detail = by_id[detail_id]
        if detail.handled_quantity + imported_quantity != (detail.quantity or 0):
            warning_count += 1

    batch = ShippingWaybillImportBatch(
        issue_id=issue.id,
        issue_number=issue.issue_number,
        filename=filename or "运单导入.xlsx",
        file_hash=digest,
        status=WaybillImportStatus.previewed.value,
        expected_quantity=expected,
        parsed_quantity=sum(row.quantity for row in parsed),
        matched_quantity=matched_quantity,
        pending_quantity=max(expected - projected_handled, 0),
        extra_quantity=max(projected_handled - expected, 0),
        matched_rows=sum(1 for _, status, _, _ in row_results if status == WaybillMatchStatus.matched.value),
        unmatched_rows=sum(1 for _, status, _, _ in row_results if status != WaybillMatchStatus.matched.value),
        warning_count=warning_count,
        created_by=getattr(user, "id", None),
    )
    db.add(batch)
    db.flush()
    for row, status, reason, detail_id in row_results:
        db.add(ShippingWaybillImportRow(
            batch_id=batch.id,
            source_sheet=row.source_sheet,
            source_row=row.source_row,
            carrier=row.carrier,
            tracking_no=row.tracking_no,
            recipient_name=row.recipient_name,
            phone=row.phone or None,
            address=row.address or None,
            quantity=row.quantity,
            no_tracking_required=row.no_tracking_required,
            match_status=status,
            match_reason=reason,
            shipping_detail_id=detail_id,
        ))
    db.commit()
    db.refresh(batch)
    return batch


def _refresh_legacy_shipping_fields(detail: ShippingDetail) -> None:
    if detail.shipping_requirement == "no_tracking_required":
        detail.shipped_at = None
        detail.shipped_quantity = None
        detail.tracking_no = None
        return
    packages = list(detail.packages)
    if not packages:
        return
    detail.shipped_quantity = sum(package.quantity or 0 for package in packages)
    detail.shipped_at = max(package.shipped_at for package in packages)
    detail.tracking_no = packages[0].tracking_no if len(packages) == 1 else None


def confirm_import(db: Session, batch_id: int, user: User) -> ShippingWaybillImportBatch:
    batch = db.query(ShippingWaybillImportBatch).filter(
        ShippingWaybillImportBatch.id == batch_id
    ).with_for_update().first()
    if not batch:
        raise HTTPException(status_code=404, detail="运单导入批次不存在")
    if batch.status == WaybillImportStatus.confirmed.value:
        return batch

    touched: dict[int, ShippingDetail] = {}
    now = datetime.now()
    for row in batch.rows:
        if row.match_status != WaybillMatchStatus.matched.value or row.shipping_detail_id is None:
            continue
        detail = row.shipping_detail
        touched[detail.id] = detail
        if row.no_tracking_required:
            detail.shipping_requirement = "no_tracking_required"
            continue
        detail.shipping_requirement = "tracking_required"
        exists = db.query(ShippingPackage.id).filter(
            ShippingPackage.carrier == row.carrier,
            ShippingPackage.tracking_no == row.tracking_no,
        ).first()
        if exists:
            continue
        package = ShippingPackage(
            shipping_detail_id=detail.id,
            import_row_id=row.id,
            carrier=row.carrier,
            tracking_no=row.tracking_no,
            quantity=row.quantity,
            shipped_at=now,
        )
        db.add(package)
        detail.packages.append(package)

    db.flush()
    for detail in touched.values():
        _refresh_legacy_shipping_fields(detail)
    batch.status = WaybillImportStatus.confirmed.value
    batch.confirmed_at = now
    record_operation(
        db,
        user=user,
        table_name="shipping_waybill_import_batches",
        record_id=batch.id,
        record_name=batch.filename,
        action="import_waybills",
        issue_number=batch.issue_number,
        changes={
            "matched_rows": batch.matched_rows,
            "matched_quantity": batch.matched_quantity,
            "pending_quantity": batch.pending_quantity,
            "warning_count": batch.warning_count,
        },
    )
    db.commit()
    db.refresh(batch)
    return batch


def fulfillment_summary(db: Session, issue_id: int) -> FulfillmentSummaryOut:
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="刊期不存在")
    details = _details_for_issue(db, issue.issue_number)
    expected = _expected_quantity(db, issue)
    planned = sum(detail.quantity or 0 for detail in details)
    tracked = sum(
        detail.handled_quantity for detail in details if detail.shipping_requirement != "no_tracking_required"
    )
    no_tracking = sum(
        detail.quantity or 0 for detail in details if detail.shipping_requirement == "no_tracking_required"
    )
    handled = tracked + no_tracking
    pending = max(expected - handled, 0)
    extra = max(handled - expected, 0)
    if extra:
        status = "exception"
    elif pending and handled:
        status = "partial"
    elif pending:
        status = "pending"
    else:
        status = "shipped"
    latest = db.query(ShippingWaybillImportBatch).filter(
        ShippingWaybillImportBatch.issue_number == issue.issue_number
    ).order_by(ShippingWaybillImportBatch.created_at.desc(), ShippingWaybillImportBatch.id.desc()).first()
    return FulfillmentSummaryOut(
        issue_id=issue.id,
        issue_number=issue.issue_number,
        expected_quantity=expected,
        planned_quantity=planned,
        handled_quantity=handled,
        tracked_quantity=tracked,
        no_tracking_quantity=no_tracking,
        pending_quantity=pending,
        extra_quantity=extra,
        package_count=sum(detail.package_count for detail in details),
        pending_detail_count=sum(1 for detail in details if detail.fulfillment_status in {"pending", "partial"}),
        status=status,
        latest_import=latest,
    )


def refresh_detail_shipping_fields(detail: ShippingDetail) -> None:
    _refresh_legacy_shipping_fields(detail)
