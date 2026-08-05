from __future__ import annotations

from contextlib import suppress
from datetime import date, datetime
from pathlib import Path
import re
from typing import Iterable

from fastapi import HTTPException
from sqlalchemy.orm import Session, joinedload

from app.models import (
    Issue,
    IssueStatus,
    PublicationSchedule,
    ReportEntry,
    ReportSourceDocument,
    ReportSourceItem,
    User,
)
from app.schemas.report_source import (
    ChannelSourceSummary,
    IssueSourceSummaryOut,
    ReportSourceConfirmIn,
    ReportSourceDocumentOut,
    ReportSourceItemOut,
    ReportSourceUploadOut,
    SourceSuggestion,
)
from app.services import attachment_service
from app.services.operation_log_service import record_operation
from app.services.report_source_ocr import CHANNEL_LABELS, recognize_report_source


ATTACHMENT_CATEGORY = "report_sources"
ALLOWED_SUFFIXES = {".pdf", ".jpg", ".jpeg", ".png"}
VALID_CHANNELS = set(CHANNEL_LABELS)
VALID_DOCUMENT_TYPES = {"weekly", "monthly", "adjustment"}


def _suffix(filename: str) -> str:
    return Path(filename).suffix.lower()


def validate_upload(channel: str, filename: str) -> None:
    if channel not in VALID_CHANNELS:
        raise HTTPException(status_code=400, detail="不支持的数据来源渠道")
    if _suffix(filename) not in ALLOWED_SUFFIXES:
        raise HTTPException(status_code=400, detail="仅支持 PDF、JPG、JPEG、PNG 文件")


def _resolve_period_issue(db: Session, period: str | None) -> int | None:
    if not period:
        return None
    try:
        month_part, ordinal_text = period.split("#", 1)
        year_text, month_text = month_part.split("-", 1)
        year, month, ordinal = int(year_text), int(month_text), int(ordinal_text)
    except (TypeError, ValueError):
        return None
    month_start = date(year, month, 1)
    month_end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    rows = (
        db.query(PublicationSchedule)
        .filter(
            PublicationSchedule.year == year,
            PublicationSchedule.is_suspended == False,
            PublicationSchedule.publish_date >= month_start,
            PublicationSchedule.publish_date < month_end,
        )
        .order_by(PublicationSchedule.publish_date)
        .all()
    )
    if 1 <= ordinal <= len(rows):
        return rows[ordinal - 1].issue_number
    return None


def _issue_number_for_source_date(db: Session, source_date: date | None) -> int | None:
    if source_date is None:
        return None
    schedule = (
        db.query(PublicationSchedule)
        .filter(PublicationSchedule.publish_date == source_date, PublicationSchedule.is_suspended == False)
        .first()
    )
    if schedule and schedule.issue_number is not None:
        return schedule.issue_number
    issue = db.query(Issue).filter(Issue.publish_date == source_date).first()
    return issue.issue_number if issue else None


def _build_display_name(
    *, channel: str, document_type: str, source_date: date | None,
    filename: str, suggestions: list[dict],
) -> str:
    suffix = _suffix(filename) or ".bin"
    channel_label = CHANNEL_LABELS[channel]
    stamp = (source_date or date.today()).strftime("%Y%m%d")
    if document_type == "monthly":
        # An explicit Chinese year/month in the original filename is more
        # reliable than an OCR date inferred from document content. Keep the
        # archive name human-readable so values such as ``202612`` cannot be
        # mistaken for either 2026-01/issue 2 or 2026-12.
        filename_month = re.search(r"(?<!\d)(20\d{2})年\s*(1[0-2]|0?[1-9])月", filename)
        if filename_month:
            year, month = int(filename_month.group(1)), int(filename_month.group(2))
        else:
            first_period = next((item.get("source_period") for item in suggestions if item.get("source_period")), None)
            period_month = re.fullmatch(r"(20\d{2})-(0[1-9]|1[0-2])#\d+", first_period or "")
            if period_month:
                year, month = int(period_month.group(1)), int(period_month.group(2))
            else:
                fallback_date = source_date or date.today()
                year, month = fallback_date.year, fallback_date.month
        return f"{year}年{month:02d}月_{channel_label}_月度报数{suffix}"
    if document_type == "adjustment":
        count = len(suggestions)
        total = sum(abs(item.get("source_quantity") or 0) for item in suggestions)
        return f"{stamp}_{channel_label}_补发调整_{count}期共{total}份{suffix}"
    return f"{stamp}_{channel_label}_原始报数{suffix}"


def _document_out(document: ReportSourceDocument, *, upload: bool = False, duplicate: bool = False):
    data = dict(
        id=document.id,
        channel=document.channel,
        document_type=document.document_type,
        original_filename=document.original_filename,
        display_name=document.display_name,
        mime_type=document.mime_type,
        size=document.size,
        sha256=document.sha256,
        source_date=document.source_date,
        extraction_status=document.extraction_status,
        extraction_json=document.extraction_json,
        uploaded_by=document.uploader.username if document.uploader else None,
        created_at=document.created_at,
        updated_at=document.updated_at,
        items=[ReportSourceItemOut.model_validate(item) for item in document.items],
    )
    if upload:
        raw_suggestions = (document.extraction_json or {}).get("suggestions", [])
        return ReportSourceUploadOut(
            **data,
            suggestions=[SourceSuggestion(**item) for item in raw_suggestions],
            duplicate=duplicate,
        )
    return ReportSourceDocumentOut(**data)


def create_source_document(
    db: Session,
    *,
    user: User,
    channel: str,
    filename: str,
    content: bytes,
    mime_type: str | None,
    current_issue_number: int | None = None,
    requested_document_type: str | None = None,
    requested_source_date: date | None = None,
) -> tuple[ReportSourceDocument, bool]:
    validate_upload(channel, filename)
    digest = attachment_service.sha256_hex(content)
    existing = (
        db.query(ReportSourceDocument)
        .options(joinedload(ReportSourceDocument.items), joinedload(ReportSourceDocument.uploader))
        .filter(ReportSourceDocument.channel == channel, ReportSourceDocument.sha256 == digest)
        .order_by(ReportSourceDocument.id.desc())
        .first()
    )
    if existing:
        normalized_display_name = _build_display_name(
            channel=existing.channel,
            document_type=existing.document_type,
            source_date=existing.source_date,
            filename=existing.original_filename,
            suggestions=(existing.extraction_json or {}).get("suggestions", []),
        )
        if existing.display_name != normalized_display_name:
            existing.display_name = normalized_display_name
            db.commit()
        return existing, True

    issue = db.query(Issue).filter(Issue.issue_number == current_issue_number).first() if current_issue_number else None
    extraction = recognize_report_source(
        channel=channel,
        filename=filename,
        content=content,
        year_hint=(issue.publish_date.year if issue else date.today().year),
    )
    source_date = requested_source_date or extraction.get("source_date")
    document_type = requested_document_type or extraction.get("document_type") or "weekly"
    if document_type not in VALID_DOCUMENT_TYPES:
        raise HTTPException(status_code=400, detail="无效的来源文件类型")

    suggestions = extraction.get("suggestions", [])
    if document_type == "adjustment":
        for suggestion in suggestions:
            suggestion.update({
                "item_kind": "adjustment",
                "applied_quantity": None,
                "source_status": "pending_review",
                "adjustment_kind": suggestion.get("adjustment_kind") or "billable_addition",
            })
    default_issue_number = current_issue_number or _issue_number_for_source_date(db, source_date)
    for suggestion in suggestions:
        resolved = _resolve_period_issue(db, suggestion.get("source_period"))
        suggestion["issue_number"] = resolved if suggestion.get("source_period") else default_issue_number
    extraction["suggestions"] = suggestions
    extraction["source_date"] = source_date.isoformat() if source_date else None

    stored_path = attachment_service.store_file(ATTACHMENT_CATEGORY, filename, content)
    document = ReportSourceDocument(
        channel=channel,
        document_type=document_type,
        original_filename=filename,
        display_name=_build_display_name(
            channel=channel,
            document_type=document_type,
            source_date=source_date,
            filename=filename,
            suggestions=suggestions,
        ),
        stored_path=stored_path,
        mime_type=mime_type,
        size=len(content),
        sha256=digest,
        source_date=source_date,
        extraction_status="pending_review",
        extraction_json=extraction,
        uploaded_by=user.id,
    )
    # Persist issue associations immediately as OCR-review rows.  This makes an
    # uploaded-but-not-yet-confirmed file visible on the issue page (and blocks
    # final report confirmation) even if the drawer is closed before review.
    # The suggested final status remains in extraction_json for the review UI.
    for suggestion in suggestions:
        if suggestion.get("issue_number") is None:
            continue
        document.items.append(ReportSourceItem(
            issue_number=suggestion["issue_number"],
            item_kind=suggestion.get("item_kind") or "base",
            category=suggestion.get("category") or channel,
            sub_category=suggestion.get("sub_category") or CHANNEL_LABELS[channel],
            source_label=suggestion.get("source_label"),
            source_quantity=suggestion.get("source_quantity"),
            applied_quantity=suggestion.get("applied_quantity"),
            source_status="pending_review",
            adjustment_kind=suggestion.get("adjustment_kind"),
            notes=suggestion.get("notes"),
        ))
    try:
        db.add(document)
        db.flush()
        record_operation(
            db,
            user=user,
            table_name="report_source_documents",
            record_id=document.id,
            record_name=document.display_name,
            action="upload_source",
            issue_number=current_issue_number,
            channel=CHANNEL_LABELS[channel],
            changes={"document_type": document_type, "sha256": digest},
        )
        db.commit()
    except Exception:
        with suppress(Exception):
            db.rollback()
        attachment_service.delete_file(stored_path)
        raise
    db.refresh(document)
    return document, False


def get_document(db: Session, document_id: int) -> ReportSourceDocument:
    document = (
        db.query(ReportSourceDocument)
        .options(joinedload(ReportSourceDocument.items), joinedload(ReportSourceDocument.uploader))
        .filter(ReportSourceDocument.id == document_id)
        .first()
    )
    if document is None:
        raise HTTPException(status_code=404, detail="来源文件不存在")
    return document


def delete_source_document(
    db: Session,
    *,
    document: ReportSourceDocument,
    user: User,
) -> None:
    """Remove an incorrect source while preserving confirmed evidence.

    Operators may withdraw only their own OCR-pending upload. Administrators
    retain the existing ability to remove any source from the archive.
    """
    is_admin = user.role.value == "admin"
    if not is_admin and document.uploaded_by != user.id:
        raise HTTPException(status_code=403, detail="只能撤销自己上传的来源文件")
    if not is_admin and document.extraction_status != "pending_review":
        raise HTTPException(status_code=403, detail="已完成核对的来源文件仅管理员可以删除")

    stored_path = document.stored_path
    issue_numbers = {item.issue_number for item in document.items}
    record_operation(
        db,
        user=user,
        table_name="report_source_documents",
        record_id=document.id,
        record_name=document.display_name,
        action="delete_source",
        issue_number=next(iter(issue_numbers)) if len(issue_numbers) == 1 else None,
        channel=CHANNEL_LABELS[document.channel],
        changes={"status": document.extraction_status, "reason": "reupload"},
    )
    db.delete(document)
    db.commit()
    attachment_service.delete_file(stored_path)


def _adjustment_deltas(kind: str | None, quantity: int | None) -> tuple[int, int]:
    amount = abs(quantity or 0)
    if kind == "billable_addition":
        return amount, amount
    if kind == "replacement":
        return 0, amount
    if kind == "reduction":
        return -amount, 0
    raise HTTPException(status_code=400, detail="调整项必须选择追加订数、补损重发或冲减")


def confirm_document(
    db: Session,
    *,
    document: ReportSourceDocument,
    data: ReportSourceConfirmIn,
    user: User,
) -> ReportSourceDocument:
    seen: set[tuple[int, str, str, str, str]] = set()
    prepared: list[ReportSourceItem] = []
    for item in data.items:
        key = (item.issue_number, item.item_kind, item.category, item.sub_category, document.channel)
        if key in seen:
            raise HTTPException(status_code=400, detail="同一来源文件存在重复刊期映射")
        seen.add(key)
        if item.category != document.channel:
            raise HTTPException(status_code=400, detail="明细渠道与来源文件渠道不一致")
        known_issue = db.query(Issue).filter(Issue.issue_number == item.issue_number).first()
        known_schedule = db.query(PublicationSchedule).filter(PublicationSchedule.issue_number == item.issue_number).first()
        if known_issue is None and known_schedule is None:
            raise HTTPException(status_code=400, detail=f"第{item.issue_number}期不在系统刊期表中")

        settlement_delta = shipping_delta = 0
        if item.item_kind == "adjustment":
            settlement_delta, shipping_delta = _adjustment_deltas(item.adjustment_kind, item.source_quantity)
        elif item.adjustment_kind is not None:
            raise HTTPException(status_code=400, detail="基础来源不能设置调整类型")

        confirmed = item.source_status == "confirmed"
        prepared.append(
            ReportSourceItem(
                document_id=document.id,
                issue_number=item.issue_number,
                item_kind=item.item_kind,
                category=item.category,
                sub_category=item.sub_category,
                source_label=item.source_label,
                source_quantity=item.source_quantity,
                applied_quantity=item.applied_quantity,
                source_status=item.source_status,
                adjustment_kind=item.adjustment_kind,
                settlement_delta=settlement_delta,
                shipping_delta=shipping_delta,
                notes=item.notes,
                confirmed_by=user.id if confirmed else None,
                confirmed_at=datetime.now() if confirmed else None,
            )
        )

        if (
            data.apply_base_values
            and item.item_kind == "base"
            and item.source_status == "confirmed"
            and item.applied_quantity is not None
            and known_issue is not None
            and known_issue.status != IssueStatus.confirmed
        ):
            entry = (
                db.query(ReportEntry)
                .filter(
                    ReportEntry.issue_id == known_issue.id,
                    ReportEntry.category == item.category,
                    ReportEntry.sub_category == item.sub_category,
                )
                .first()
            )
            if entry is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"第{item.issue_number}期缺少报数项 {item.category}/{item.sub_category}",
                )
            entry.value = item.applied_quantity

    db.query(ReportSourceItem).filter(ReportSourceItem.document_id == document.id).delete()
    db.add_all(prepared)
    document.extraction_status = "confirmed" if all(item.source_status == "confirmed" for item in data.items) else "reviewed"
    record_operation(
        db,
        user=user,
        table_name="report_source_documents",
        record_id=document.id,
        record_name=document.display_name,
        action="confirm_source",
        issue_number=data.items[0].issue_number if len({item.issue_number for item in data.items}) == 1 else None,
        channel=CHANNEL_LABELS[document.channel],
        changes={"items": len(prepared), "status": document.extraction_status},
    )
    db.commit()
    return get_document(db, document.id)


def _base_quantities(db: Session, issue: Issue) -> dict[str, int]:
    rows = db.query(ReportEntry.category, ReportEntry.value).filter(ReportEntry.issue_id == issue.id).all()
    totals: dict[str, int] = {}
    for category, value in rows:
        totals[category] = totals.get(category, 0) + (value or 0)
    return totals


def apply_confirmed_source_bases_to_issue(db: Session, issue: Issue) -> int:
    """Apply archived monthly/weekly base values when a future issue is created.

    Source items deliberately reference the stable issue number rather than the
    Issue primary key.  This lets a monthly file be reviewed before every issue
    row exists; creation later consumes only values that a user already marked
    confirmed.  Channel-pending and OCR-review rows remain visible but are not
    written into the report.
    """
    source_items = (
        db.query(ReportSourceItem)
        .filter(
            ReportSourceItem.issue_number == issue.issue_number,
            ReportSourceItem.item_kind == "base",
            ReportSourceItem.source_status == "confirmed",
            ReportSourceItem.applied_quantity.isnot(None),
        )
        .order_by(ReportSourceItem.confirmed_at, ReportSourceItem.id)
        .all()
    )
    if not source_items:
        return 0

    entries = {
        (entry.category, entry.sub_category): entry
        for entry in db.query(ReportEntry).filter(ReportEntry.issue_id == issue.id).all()
    }
    applied = 0
    # Later confirmations win if more than one archived source maps to the same
    # issue/channel.  The evidence remains fully traceable in the source list.
    for source_item in source_items:
        entry = entries.get((source_item.category, source_item.sub_category))
        if entry is not None:
            entry.value = source_item.applied_quantity
            applied += 1
    return applied


def get_issue_summary(db: Session, issue: Issue) -> IssueSourceSummaryOut:
    documents = (
        db.query(ReportSourceDocument)
        .join(ReportSourceItem)
        .options(joinedload(ReportSourceDocument.items), joinedload(ReportSourceDocument.uploader))
        .filter(ReportSourceItem.issue_number == issue.issue_number)
        .distinct()
        .order_by(ReportSourceDocument.created_at.desc(), ReportSourceDocument.id.desc())
        .all()
    )
    issue_items = [item for document in documents for item in document.items if item.issue_number == issue.issue_number]
    bases = _base_quantities(db, issue)
    channel_codes = sorted({item.category for item in issue_items} | set(bases))
    channels: list[ChannelSourceSummary] = []
    for channel in channel_codes:
        items = [item for item in issue_items if item.category == channel]
        adjustments = [item for item in items if item.item_kind == "adjustment" and item.source_status == "confirmed"]
        settlement_delta = sum(item.settlement_delta for item in adjustments)
        shipping_delta = sum(item.shipping_delta for item in adjustments)
        shipped = sum(item.shipped_quantity for item in adjustments)
        channels.append(
            ChannelSourceSummary(
                channel=channel,
                document_count=len({item.document_id for item in items}),
                base_quantity=bases.get(channel, 0),
                settlement_delta=settlement_delta,
                settlement_total=bases.get(channel, 0) + settlement_delta,
                shipping_delta=shipping_delta,
                shipped_quantity=shipped,
                pending_shipping=max(0, shipping_delta - shipped),
                pending_count=sum(item.source_status != "confirmed" for item in items),
            )
        )
    return IssueSourceSummaryOut(
        issue_number=issue.issue_number,
        document_count=len(documents),
        documents=[_document_out(document) for document in documents],
        channels=channels,
    )


def update_adjustment_shipping(
    db: Session,
    *,
    item: ReportSourceItem,
    shipped_quantity: int,
    tracking_no: str | None,
    shipped_at: datetime | None,
) -> ReportSourceItem:
    if item.item_kind != "adjustment":
        raise HTTPException(status_code=400, detail="只有补发调整可以登记发货")
    if shipped_quantity < 0 or shipped_quantity > item.shipping_delta:
        raise HTTPException(status_code=400, detail="已补发份数不能超过应补发份数")
    item.shipped_quantity = shipped_quantity
    item.tracking_no = tracking_no
    item.shipped_at = shipped_at
    db.commit()
    db.refresh(item)
    return item
