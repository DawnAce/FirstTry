from dataclasses import asdict
from contextlib import suppress
from datetime import date, datetime
from pathlib import Path
import re
from uuid import uuid4

from sqlalchemy.orm import Session

from app.cache import invalidate_dashboard_cache
from app.models import (
    Issue,
    PublicationSchedule,
    PublicationScheduleUpload,
    PublicationScheduleUploadStatus,
)
from app.services.publication_schedule_parser import (
    ScheduleRowDraft,
    parse_schedule_pdf,
    summarize_rows,
    validate_schedule_rows,
)


UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads" / "publication_schedules"
MAX_FILENAME_BYTES = 255
MAX_PDF_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_PDF_UPLOAD_MB = MAX_PDF_UPLOAD_BYTES // (1024 * 1024)


def _truncate_utf8(value: str, max_bytes: int) -> str:
    result: list[str] = []
    used_bytes = 0
    for character in value:
        character_bytes = len(character.encode("utf-8"))
        if used_bytes + character_bytes > max_bytes:
            break
        result.append(character)
        used_bytes += character_bytes
    return "".join(result)


def _safe_filename(filename: str) -> str:
    path = Path(filename)
    suffix = path.suffix.lower() or ".pdf"
    unique_token = uuid4().hex
    stem = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff._-]", "_", path.stem)
    stem = stem.strip("._") or "publication_schedule"
    suffix_bytes = len(suffix.encode("utf-8"))
    max_stem_bytes = max(0, MAX_FILENAME_BYTES - len("_") - len(unique_token) - suffix_bytes)
    stem = _truncate_utf8(stem, max_stem_bytes)
    return f"{stem}_{unique_token}{suffix}"


def store_uploaded_pdf(year: int, filename: str, content: bytes) -> str:
    year_dir = UPLOAD_ROOT / str(year)
    year_dir.mkdir(parents=True, exist_ok=True)

    stored_file = year_dir / _safe_filename(filename)
    stored_file.write_bytes(content)

    return stored_file.relative_to(UPLOAD_ROOT.parents[1]).as_posix()


def _normalize_upload_filename(filename: str | None) -> str:
    normalized = (filename or "").strip() or "publication_schedule.pdf"
    if len(normalized) > 255:
        raise ValueError("文件名不能超过 255 个字符")
    return normalized


def _validate_preview_upload(
    filename: str,
    content_type: str | None,
    content: bytes,
    username: str | None,
) -> None:
    is_pdf_content_type = content_type in {
        "application/pdf",
        "application/octet-stream",
        None,
    }
    is_pdf_filename = Path(filename).suffix.lower() == ".pdf"
    if not (is_pdf_content_type and is_pdf_filename):
        raise ValueError("请上传 PDF 文件")

    if not content:
        raise ValueError("上传文件为空")

    if len(content) > MAX_PDF_UPLOAD_BYTES:
        raise ValueError(f"PDF 文件不能超过 {MAX_PDF_UPLOAD_MB} MB")

    if username is not None and len(username) > 50:
        raise ValueError("上传用户名不能超过 50 个字符")


def _serialize_rows(rows: list[ScheduleRowDraft]) -> list[dict[str, object]]:
    return [
        {
            "publish_date": row.publish_date.isoformat(),
            "issue_number": row.issue_number,
            "is_suspended": row.is_suspended,
        }
        for row in rows
    ]


def _deserialize_rows(rows_json: object) -> list[ScheduleRowDraft]:
    if not isinstance(rows_json, list):
        raise ValueError("上传记录缺少预览行")

    rows: list[ScheduleRowDraft] = []
    try:
        for row in rows_json:
            if not isinstance(row, dict):
                raise ValueError
            issue_number = row.get("issue_number")
            rows.append(
                ScheduleRowDraft(
                    publish_date=date.fromisoformat(str(row["publish_date"])),
                    issue_number=None if issue_number is None else int(issue_number),
                    is_suspended=bool(row["is_suspended"]),
                )
            )
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("上传记录预览行格式无效") from exc

    return rows


def create_preview_upload(
    db: Session,
    filename: str | None,
    content_type: str | None,
    content: bytes,
    username: str | None,
) -> tuple[PublicationScheduleUpload, list[ScheduleRowDraft]]:
    normalized_filename = _normalize_upload_filename(filename)
    _validate_preview_upload(normalized_filename, content_type, content, username)

    parsed = parse_schedule_pdf(content)
    stored_path = store_uploaded_pdf(parsed.year, normalized_filename, content)
    upload = PublicationScheduleUpload(
        year=parsed.year,
        original_filename=normalized_filename,
        stored_path=stored_path,
        status=PublicationScheduleUploadStatus.previewed,
        summary_json=asdict(parsed.summary),
        rows_json=_serialize_rows(parsed.rows),
        error_json=parsed.errors,
        uploaded_by=username,
        raw_text=parsed.raw_text,
    )

    try:
        db.add(upload)
        db.commit()
    except Exception:
        rollback = getattr(db, "rollback", None)
        if rollback is not None:
            with suppress(Exception):
                rollback()
        stored_file = UPLOAD_ROOT.parents[1] / Path(stored_path)
        with suppress(OSError):
            if stored_file.exists():
                stored_file.unlink()
        raise

    db.refresh(upload)
    return upload, parsed.rows


def ensure_commit_is_safe(db: Session, year: int, rows: list[ScheduleRowDraft]) -> None:
    start_date = date(year, 1, 1)
    end_date = date(year, 12, 31)
    existing_issues = (
        db.query(Issue)
        .filter(Issue.publish_date >= start_date, Issue.publish_date <= end_date)
        .all()
    )

    rows_by_issue_number = {
        row.issue_number: row
        for row in rows
        if not row.is_suspended and row.issue_number is not None
    }

    for issue in existing_issues:
        row = rows_by_issue_number.get(issue.issue_number)
        if row is None:
            raise ValueError(f"第 {issue.issue_number} 期已创建，不能从刊期表中移除")

        if row.publish_date != issue.publish_date:
            raise ValueError(
                f"第 {issue.issue_number} 期已创建，不能将出版日期从 {issue.publish_date} 改为 {row.publish_date}"
            )


def commit_schedule_upload(
    db: Session,
    upload_id: int,
) -> PublicationScheduleUpload:
    upload = (
        db.query(PublicationScheduleUpload)
        .filter(PublicationScheduleUpload.id == upload_id)
        .first()
    )
    if upload is None:
        raise ValueError("上传记录不存在")
    if upload.status != PublicationScheduleUploadStatus.previewed:
        raise ValueError("只有待确认的刊期表上传记录可以提交")
    if upload.error_json:
        raise ValueError("；".join(upload.error_json))

    rows = _deserialize_rows(upload.rows_json)

    errors = validate_schedule_rows(upload.year, rows)
    if errors:
        upload.status = PublicationScheduleUploadStatus.failed
        upload.error_json = errors
        db.commit()
        raise ValueError("；".join(errors))

    try:
        ensure_commit_is_safe(db, upload.year, rows)
    except ValueError as exc:
        upload.status = PublicationScheduleUploadStatus.failed
        upload.error_json = [str(exc)]
        db.commit()
        raise

    try:
        db.query(PublicationSchedule).filter(PublicationSchedule.year == upload.year).delete(
            synchronize_session=False
        )
        for row in sorted(rows, key=lambda item: item.publish_date):
            db.add(
                PublicationSchedule(
                    year=upload.year,
                    issue_number=None if row.is_suspended else row.issue_number,
                    publish_date=row.publish_date,
                    is_suspended=row.is_suspended,
                )
            )

        upload.status = PublicationScheduleUploadStatus.committed
        upload.summary_json = asdict(
            summarize_rows(rows, (upload.summary_json or {}).get("remarks"))
        )
        upload.error_json = []
        upload.committed_at = datetime.now()

        db.commit()
    except Exception:
        db.rollback()
        raise
    invalidate_dashboard_cache()
    db.refresh(upload)
    return upload
