from __future__ import annotations

from contextlib import suppress
from datetime import date, datetime
from pathlib import Path
import re
from typing import Iterable

from fastapi import HTTPException
from sqlalchemy import or_
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
PREPRESS_ACTIONS = {"base", "prepress_addition"}


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
        base_name = f"{stamp}_{channel_label}_确认后凭证"
        period_keys = [
            item.get("issue_number") or item.get("source_period")
            for item in suggestions
        ]
        quantities = [item.get("source_quantity") for item in suggestions]
        # One issue may contain several rows (for example postal local and
        # non-local quantities), so rows must not be described as periods.
        # If OCR did not reliably produce every period and quantity, omit the
        # statistic entirely instead of archiving a misleading "N期共0份".
        has_complete_periods = bool(period_keys) and all(period_keys)
        has_complete_quantities = bool(quantities) and all(
            isinstance(quantity, int) and not isinstance(quantity, bool)
            for quantity in quantities
        )
        if has_complete_periods and has_complete_quantities:
            count = len(set(period_keys))
            total = sum(abs(quantity) for quantity in quantities)
            if total > 0:
                return f"{base_name}_{count}期共{total}份{suffix}"
        return f"{base_name}{suffix}"
    return f"{stamp}_{channel_label}_原始报数{suffix}"


def _document_out(document: ReportSourceDocument, *, upload: bool = False, duplicate: bool = False):
    try:
        file_available = attachment_service.resolve_path(document.stored_path).is_file()
    except ValueError:
        file_available = False
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
        upload_issue_number=document.upload_issue_number,
        file_available=file_available,
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
                # A confirmed issue is immutable.  When OCR has not explicitly
                # identified a supplement/reduction, archive the evidence by
                # default so a source document cannot silently alter settlement.
                "adjustment_kind": suggestion.get("adjustment_kind") or "archive_only",
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
        upload_issue_number=current_issue_number,
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
            source_action=suggestion.get("source_action") or (
                _action_for_adjustment(suggestion.get("adjustment_kind"))
                if suggestion.get("item_kind") == "adjustment" else "base"
            ),
            applied_phase=(
                "post_confirmation" if suggestion.get("item_kind") == "adjustment" else "pre_confirmation"
            ),
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
    if kind == "archive_only":
        return 0, 0
    if kind == "billable_addition":
        return amount, amount
    if kind == "replacement":
        return 0, amount
    if kind == "reduction":
        return -amount, 0
    raise HTTPException(status_code=400, detail="确认后凭证必须选择仅归档、追加订数、补损重发或冲减")


def _action_for_adjustment(kind: str | None) -> str:
    return {
        "archive_only": "archive_only",
        "billable_addition": "postpress_addition",
        "replacement": "damage_reshipment",
        "reduction": "reduction",
    }.get(kind, "archive_only")


def _active_print_totals(
    db: Session,
    issue_number: int,
) -> dict[tuple[str, str], int]:
    items = (
        db.query(ReportSourceItem)
        .filter(
            ReportSourceItem.issue_number == issue_number,
            ReportSourceItem.source_status == "confirmed",
            ReportSourceItem.effect_status == "active",
            ReportSourceItem.source_action.in_(PREPRESS_ACTIONS),
        )
        .all()
    )
    totals: dict[tuple[str, str], int] = {}
    for item in items:
        key = (item.category, item.sub_category)
        totals[key] = totals.get(key, 0) + item.print_delta
    return totals


def _apply_print_totals_to_issue(
    db: Session,
    issue: Issue,
    keys: set[tuple[str, str]] | None = None,
) -> int:
    totals = _active_print_totals(db, issue.issue_number)
    entries = {
        (entry.category, entry.sub_category): entry
        for entry in db.query(ReportEntry).filter(ReportEntry.issue_id == issue.id).all()
    }
    applied = 0
    for key, total in totals.items():
        if keys is not None and key not in keys:
            continue
        entry = entries.get(key)
        if entry is not None:
            entry.value = total
            applied += 1
    return applied


def confirm_document(
    db: Session,
    *,
    document: ReportSourceDocument,
    data: ReportSourceConfirmIn,
    user: User,
) -> ReportSourceDocument:
    if document.extraction_status == "confirmed":
        raise HTTPException(status_code=409, detail="已确认来源不可直接改写，请使用“重新上传”定向替换")

    seen: set[tuple[int, str, str, str, str]] = set()
    prepared: list[ReportSourceItem] = []
    replacement_targets: list[ReportSourceItem] = []
    affected_draft_keys: dict[int, set[tuple[str, str]]] = {}
    for item in data.items:
        key = (item.issue_number, item.item_kind, item.category, item.sub_category, document.channel)
        if key in seen:
            raise HTTPException(status_code=400, detail="同一来源文件存在重复刊期映射")
        seen.add(key)
        if item.category != document.channel:
            raise HTTPException(status_code=400, detail="明细渠道与来源文件渠道不一致")
        # Lock the issue row while deciding whether this is a prepress
        # contribution or a postpress adjustment.  This prevents a concurrent
        # report confirmation from changing phase halfway through the commit.
        known_issue = (
            db.query(Issue)
            .filter(Issue.issue_number == item.issue_number)
            .with_for_update()
            .first()
        )
        known_schedule = db.query(PublicationSchedule).filter(PublicationSchedule.issue_number == item.issue_number).first()
        if known_issue is None and known_schedule is None:
            raise HTTPException(status_code=400, detail=f"第{item.issue_number}期不在系统刊期表中")

        settlement_delta = shipping_delta = 0
        source_action = item.source_action
        applied_phase = "pre_confirmation"
        print_delta = 0
        replacement_target = None
        if item.item_kind == "adjustment":
            settlement_delta, shipping_delta = _adjustment_deltas(item.adjustment_kind, item.source_quantity)
            source_action = _action_for_adjustment(item.adjustment_kind)
            applied_phase = "post_confirmation"
            if known_issue is None or known_issue.status != IssueStatus.confirmed:
                raise HTTPException(status_code=409, detail="印数确认后的调整只能登记到已确认刊期")
        elif item.adjustment_kind is not None:
            raise HTTPException(status_code=400, detail="基础来源不能设置调整类型")
        elif source_action not in PREPRESS_ACTIONS:
            raise HTTPException(status_code=400, detail="印数来源只能选择基础数据或印前追加")
        elif known_issue is not None and known_issue.status == IssueStatus.confirmed:
            raise HTTPException(status_code=409, detail="印数已确认，请将后续数据登记到结算与补发凭证")

        if item.supersedes_item_id is not None:
            if item.item_kind != "base":
                raise HTTPException(status_code=400, detail="后续调整暂不支持通过印数来源替换")
            replacement_target = (
                db.query(ReportSourceItem)
                .filter(ReportSourceItem.id == item.supersedes_item_id)
                .first()
            )
            if replacement_target is None:
                raise HTTPException(status_code=404, detail="要替换的来源明细不存在")
            if (
                replacement_target.effect_status != "active"
                or replacement_target.source_status != "confirmed"
                or replacement_target.source_action not in PREPRESS_ACTIONS
            ):
                raise HTTPException(status_code=409, detail="只能替换当前有效的已确认印数来源")
            if (
                replacement_target.issue_number != item.issue_number
                or replacement_target.category != item.category
                or replacement_target.sub_category != item.sub_category
            ):
                raise HTTPException(status_code=400, detail="新文件明细与被替换来源的刊期或项目不一致")
            source_action = replacement_target.source_action
            replacement_targets.append(replacement_target)

        confirmed = item.source_status == "confirmed"
        if item.item_kind == "base":
            print_delta = item.applied_quantity or 0
            if confirmed and source_action == "base" and replacement_target is None:
                active_base = (
                    db.query(ReportSourceItem.id)
                    .filter(
                        ReportSourceItem.issue_number == item.issue_number,
                        ReportSourceItem.category == item.category,
                        ReportSourceItem.sub_category == item.sub_category,
                        ReportSourceItem.source_action == "base",
                        ReportSourceItem.source_status == "confirmed",
                        ReportSourceItem.effect_status == "active",
                    )
                    .first()
                )
                if active_base is not None:
                    raise HTTPException(status_code=409, detail="该项目已有基础来源，请选择“追加”或定向“重新上传”")

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
                source_action=source_action,
                applied_phase=applied_phase,
                print_delta=print_delta,
                effect_status="active",
                supersedes_item_id=item.supersedes_item_id,
                adjustment_kind=item.adjustment_kind,
                settlement_delta=settlement_delta,
                shipping_delta=shipping_delta,
                notes=item.notes,
                confirmed_by=user.id if confirmed else None,
                confirmed_at=datetime.now() if confirmed else None,
            )
        )

        if confirmed and item.item_kind == "base" and known_issue is not None:
            affected_draft_keys.setdefault(known_issue.id, set()).add((item.category, item.sub_category))

    db.query(ReportSourceItem).filter(ReportSourceItem.document_id == document.id).delete()
    db.add_all(prepared)
    db.flush()
    for target in replacement_targets:
        target.effect_status = "replaced"
    # Flush replacement invalidations before aggregating.  SQLAlchemy queries
    # do not necessarily autoflush changes made after an explicit flush in the
    # same unit of work (notably under the SQLite test transaction).
    db.flush()

    if data.apply_base_values:
        for issue_id, keys in affected_draft_keys.items():
            affected_issue = db.query(Issue).filter(Issue.id == issue_id).first()
            if affected_issue is None or affected_issue.status == IssueStatus.confirmed:
                raise HTTPException(status_code=409, detail="刊期状态已变化，请刷新后重新选择来源操作")
            missing = [
                key for key in keys
                if db.query(ReportEntry).filter(
                    ReportEntry.issue_id == issue_id,
                    ReportEntry.category == key[0],
                    ReportEntry.sub_category == key[1],
                ).first() is None
            ]
            if missing:
                category, sub_category = missing[0]
                raise HTTPException(status_code=400, detail=f"第{affected_issue.issue_number}期缺少报数项 {category}/{sub_category}")
            _apply_print_totals_to_issue(db, affected_issue, keys)
    document.extraction_status = "confirmed" if all(item.source_status == "confirmed" for item in data.items) else "reviewed"
    # Refresh the human-readable archive name from the reviewed values. This
    # fixes a provisional upload name when OCR initially missed a quantity and
    # the reviewer supplied it manually.
    document.display_name = _build_display_name(
        channel=document.channel,
        document_type=document.document_type,
        source_date=document.source_date,
        filename=document.original_filename,
        suggestions=[item.model_dump() for item in data.items],
    )
    record_operation(
        db,
        user=user,
        table_name="report_source_documents",
        record_id=document.id,
        record_name=document.display_name,
        action="confirm_source",
        issue_number=data.items[0].issue_number if len({item.issue_number for item in data.items}) == 1 else None,
        channel=CHANNEL_LABELS[document.channel],
        changes={
            "items": len(prepared),
            "status": document.extraction_status,
            "actions": sorted({item.source_action for item in prepared}),
            "replaced_items": [item.id for item in replacement_targets],
        },
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
    if not _active_print_totals(db, issue.issue_number):
        return 0
    return _apply_print_totals_to_issue(db, issue)


def get_issue_summary(db: Session, issue: Issue) -> IssueSourceSummaryOut:
    documents = (
        db.query(ReportSourceDocument)
        .options(joinedload(ReportSourceDocument.items), joinedload(ReportSourceDocument.uploader))
        .filter(or_(
            ReportSourceDocument.upload_issue_number == issue.issue_number,
            ReportSourceDocument.items.any(ReportSourceItem.issue_number == issue.issue_number),
        ))
        .order_by(ReportSourceDocument.created_at.desc(), ReportSourceDocument.id.desc())
        .all()
    )
    issue_items = [item for document in documents for item in document.items if item.issue_number == issue.issue_number]
    bases = _base_quantities(db, issue)
    source_totals_by_key = _active_print_totals(db, issue.issue_number)
    channel_codes = sorted({item.category for item in issue_items} | set(bases))
    channels: list[ChannelSourceSummary] = []
    for channel in channel_codes:
        items = [item for item in issue_items if item.category == channel]
        active_items = [item for item in items if item.effect_status == "active"]
        adjustments = [
            item for item in active_items
            if item.item_kind == "adjustment" and item.source_status == "confirmed"
        ]
        source_total = sum(total for (category, _sub_category), total in source_totals_by_key.items() if category == channel)
        settlement_delta = sum(item.settlement_delta for item in adjustments)
        shipping_delta = sum(item.shipping_delta for item in adjustments)
        shipped = sum(item.shipped_quantity for item in adjustments)
        channels.append(
            ChannelSourceSummary(
                channel=channel,
                document_count=len({item.document_id for item in items}),
                base_quantity=bases.get(channel, 0),
                source_total=source_total,
                source_difference=source_total - bases.get(channel, 0),
                active_source_count=len({
                    item.document_id for item in active_items
                    if item.source_status == "confirmed" and item.source_action in PREPRESS_ACTIONS
                }),
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
