from dataclasses import asdict
from contextlib import suppress
from datetime import date
from pathlib import Path
import re
from uuid import uuid4

from sqlalchemy.orm import Session

from app.models import (
    Issue,
    PublicationScheduleUpload,
    PublicationScheduleUploadStatus,
)
from app.services.publication_schedule_parser import (
    ScheduleRowDraft,
    parse_schedule_pdf,
)


UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads" / "publication_schedules"


def _safe_filename(filename: str) -> str:
    path = Path(filename)
    suffix = path.suffix.lower() or ".pdf"
    unique_token = uuid4().hex
    stem = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff._-]", "_", path.stem)
    stem = stem.strip("._") or "publication_schedule"
    max_stem_length = max(0, 255 - len("_") - len(unique_token) - len(suffix))
    stem = stem[:max_stem_length]
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

    if username is not None and len(username) > 50:
        raise ValueError("上传用户名不能超过 50 个字符")


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
        error_json=parsed.errors,
        uploaded_by=username,
        raw_text=parsed.raw_text,
    )

    try:
        db.add(upload)
        db.commit()
        db.refresh(upload)
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
