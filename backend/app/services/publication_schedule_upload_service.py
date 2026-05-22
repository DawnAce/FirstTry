from dataclasses import asdict
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
    stem = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff._-]", "_", path.stem)
    stem = stem.strip("._") or "publication_schedule"
    return f"{stem}_{uuid4().hex}{suffix}"


def store_uploaded_pdf(year: int, filename: str, content: bytes) -> str:
    year_dir = UPLOAD_ROOT / str(year)
    year_dir.mkdir(parents=True, exist_ok=True)

    stored_file = year_dir / _safe_filename(filename)
    stored_file.write_bytes(content)

    return str(stored_file.relative_to(UPLOAD_ROOT.parents[1]))


def create_preview_upload(db, filename, content_type, content, username):
    is_pdf_content_type = content_type in {
        "application/pdf",
        "application/octet-stream",
        None,
    }
    is_pdf_filename = filename.lower().endswith(".pdf")
    if not (is_pdf_content_type or is_pdf_filename):
        raise ValueError("请上传 PDF 文件")

    if not content:
        raise ValueError("上传文件为空")

    parsed = parse_schedule_pdf(content)
    stored_path = store_uploaded_pdf(parsed.year, filename, content)
    upload = PublicationScheduleUpload(
        year=parsed.year,
        original_filename=filename,
        stored_path=stored_path,
        status=PublicationScheduleUploadStatus.previewed,
        summary_json=asdict(parsed.summary),
        error_json=parsed.errors,
        uploaded_by=username,
        raw_text=parsed.raw_text,
    )

    db.add(upload)
    db.commit()
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
