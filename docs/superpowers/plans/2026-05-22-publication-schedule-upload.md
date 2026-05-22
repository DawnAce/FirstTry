# Publication Schedule Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin workflow to upload an annual publication schedule PDF, preview and correct parsed rows, then save structured schedule data that drives issue creation.

**Architecture:** Keep `publication_schedule` as the canonical schedule table and add `publication_schedule_uploads` as an audit/source table for uploaded PDFs and parse metadata. Add a focused parser service that converts extractable PDF text into validated schedule rows, then expose preview/commit endpoints. Add a React management page that uploads PDFs, shows an editable preview, commits corrected rows, and invalidates schedule/dashboard caches.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, Pydantic v2, pypdf, React, TypeScript, Ant Design, TanStack Query, Vitest, open existing MySQL-backed development setup.

---

## File Structure

Create or modify these files:

- Create `backend/app/models/publication_schedule_upload.py`: SQLAlchemy upload/audit model.
- Modify `backend/app/models/__init__.py`: export the new model.
- Create `backend/alembic/versions/3f2b7a9c1d0e_add_publication_schedule_uploads.py`: migration for the upload/audit table.
- Modify `backend/requirements.txt`: add `pypdf==4.3.1`.
- Create `backend/app/schemas/publication_schedule_upload.py`: Pydantic schemas for preview, rows, summaries, uploads, and commit body.
- Create `backend/app/services/publication_schedule_parser.py`: pure parsing and validation functions.
- Create `backend/app/services/publication_schedule_upload_service.py`: file storage, upload record creation, commit transaction.
- Modify `backend/app/api/schedule.py`: keep `GET /api/schedule`, add upload list/preview/commit routes.
- Modify `backend/app/main.py`: no new router is required if schedule routes stay in `schedule.py`; ensure cache invalidation is used after commit.
- Create `backend/tests/test_publication_schedule_parser.py`: parser and validator tests using 2026 text.
- Create `backend/tests/test_publication_schedule_upload_service.py`: commit safety tests against existing issues.
- Create `frontend/src/api/schedule.ts`: schedule upload/list/commit client functions and types.
- Create `frontend/src/pages/PublicationScheduleManager.tsx`: annual schedule management UI.
- Modify `frontend/src/App.tsx`: add `/schedule` route.
- Modify `frontend/src/components/AppLayout.tsx`: add side nav item and selected-key mapping.
- Create `frontend/src/pages/publicationScheduleUtils.ts`: grouping/summary helpers for testable UI logic.
- Create `frontend/src/pages/publicationScheduleUtils.test.ts`: Vitest tests for grouping and error detection.
- Modify `README.md`, `docs/technical.md`, `docs/requirements.md`, `docs/user-guide.md`: document the new workflow.

## Task 1: Backend parser service

**Files:**
- Create: `backend/app/services/publication_schedule_parser.py`
- Create: `backend/tests/test_publication_schedule_parser.py`
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Add PDF text extraction dependency**

Add this exact line to `backend/requirements.txt`:

```txt
pypdf==4.3.1
```

- [ ] **Step 2: Write parser tests first**

Create `backend/tests/test_publication_schedule_parser.py` with:

```python
from datetime import date

import pytest

from app.services.publication_schedule_parser import (
    ScheduleRowDraft,
    extract_year,
    parse_schedule_text,
    summarize_rows,
    validate_schedule_rows,
)


SCHEDULE_2026_TEXT = """
二O二六年出版日期、期号对照表
邮发代号：1-76
报刊名称：中国经营报 出版日期：周一
第一季度 第二季度 第三季度 第四季度
1月 2月 3月 4月 5月 6月 7月 8月 9月 10月 11月 12月
日期 期数 日期 期数 日期 期数 日期 期数 日期 期数 日期 期数 日期 期数 日期 期数 日期 期数 日期 期数 日期 期数 日期 期数
5 2635 2 2639 2 2641 6 2646 4 2650 1 2654 6 2659 3 2663 7 2668 5 休刊 2 2675 7 2680
12 2636 9 2640 9 2642 13 2647 11 2651 8 2655 13 2660 10 2664 14 2669 12 2672 9 2676 14 2681
19 2637 16 休刊 16 2643 20 2648 18 2652 15 2656 20 2661 17 2665 21 2670 19 2673 16 2677 21 2682
26 2638 23 休刊 23 2644 27 2649 25 2653 22 2657 27 2662 24 2666 28 2671 26 2674 23 2678 28 2683
30 2645 29 2658 31 2667 30 2679
备注：全年出版正报49期，对开 24 版，全年定价240元
单位盖章：《中国经营报》社有限公司 日期：2025-6-18
"""


def test_extract_year_supports_chinese_zero_variant():
    assert extract_year(SCHEDULE_2026_TEXT) == 2026


def test_parse_schedule_text_extracts_2026_rows():
    parsed = parse_schedule_text(SCHEDULE_2026_TEXT)

    assert parsed.year == 2026
    assert parsed.summary.total_rows == 52
    assert parsed.summary.published_count == 49
    assert parsed.summary.suspended_count == 3
    assert parsed.summary.first_issue_number == 2635
    assert parsed.summary.last_issue_number == 2683
    assert parsed.errors == []

    suspended_dates = {row.publish_date for row in parsed.rows if row.is_suspended}
    assert suspended_dates == {
        date(2026, 2, 16),
        date(2026, 2, 23),
        date(2026, 10, 5),
    }

    published_issue_numbers = [
        row.issue_number for row in parsed.rows if not row.is_suspended
    ]
    assert published_issue_numbers == list(range(2635, 2684))


def test_validate_schedule_rows_rejects_suspended_row_with_issue_number():
    errors = validate_schedule_rows(
        2026,
        [
            ScheduleRowDraft(
                publish_date=date(2026, 1, 5),
                issue_number=2635,
                is_suspended=False,
            ),
            ScheduleRowDraft(
                publish_date=date(2026, 1, 12),
                issue_number=2636,
                is_suspended=True,
            ),
        ],
    )

    assert "2026-01-12 是休刊行，不能填写期号" in errors


def test_validate_schedule_rows_rejects_non_continuous_issue_numbers():
    errors = validate_schedule_rows(
        2026,
        [
            ScheduleRowDraft(
                publish_date=date(2026, 1, 5),
                issue_number=2635,
                is_suspended=False,
            ),
            ScheduleRowDraft(
                publish_date=date(2026, 1, 12),
                issue_number=2637,
                is_suspended=False,
            ),
        ],
    )

    assert "期号必须连续递增：2635 后应为 2636，实际为 2637" in errors


def test_validate_schedule_rows_rejects_duplicate_dates():
    errors = validate_schedule_rows(
        2026,
        [
            ScheduleRowDraft(
                publish_date=date(2026, 1, 5),
                issue_number=2635,
                is_suspended=False,
            ),
            ScheduleRowDraft(
                publish_date=date(2026, 1, 5),
                issue_number=2636,
                is_suspended=False,
            ),
        ],
    )

    assert "同一年内出版日期重复：2026-01-05" in errors


def test_summarize_rows_handles_empty_rows():
    summary = summarize_rows([])

    assert summary.total_rows == 0
    assert summary.published_count == 0
    assert summary.suspended_count == 0
    assert summary.first_issue_number is None
    assert summary.last_issue_number is None
```

- [ ] **Step 3: Run parser tests and verify they fail because service does not exist**

Run:

```powershell
cd backend
python -m pytest tests\test_publication_schedule_parser.py -q
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.publication_schedule_parser'`.

- [ ] **Step 4: Implement parser service**

Create `backend/app/services/publication_schedule_parser.py` with:

```python
"""Parse and validate annual publication schedule PDFs."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import io
import re
from typing import Iterable

from pypdf import PdfReader


_CHINESE_YEAR_DIGITS = {
    "零": "0",
    "〇": "0",
    "O": "0",
    "Ｏ": "0",
    "一": "1",
    "二": "2",
    "三": "3",
    "四": "4",
    "五": "5",
    "六": "6",
    "七": "7",
    "八": "8",
    "九": "9",
}

@dataclass(frozen=True)
class ScheduleRowDraft:
    publish_date: date
    issue_number: int | None
    is_suspended: bool


@dataclass(frozen=True)
class ScheduleSummary:
    total_rows: int
    published_count: int
    suspended_count: int
    first_issue_number: int | None
    last_issue_number: int | None
    remarks: str | None = None


@dataclass(frozen=True)
class ParsedSchedule:
    year: int
    rows: list[ScheduleRowDraft]
    summary: ScheduleSummary
    errors: list[str]
    raw_text: str


def extract_pdf_text(content: bytes) -> str:
    """Extract text from a PDF that contains selectable text."""
    try:
        reader = PdfReader(io.BytesIO(content))
    except Exception as exc:
        raise ValueError("无法读取 PDF 文件，请确认文件未损坏") from exc

    text_parts = [(page.extract_text() or "") for page in reader.pages]
    text = "\n".join(part for part in text_parts if part.strip()).strip()
    if not text:
        raise ValueError("PDF 未包含可抽取文本，请上传文字版 PDF")
    return text


def extract_year(text: str) -> int:
    """Extract the publication schedule year from Arabic or Chinese year text."""
    arabic_match = re.search(r"(20\d{2})年", text)
    if arabic_match:
        return int(arabic_match.group(1))

    chinese_match = re.search(r"([二两][零〇OＯ一二三四五六七八九]{3})年", text)
    if not chinese_match:
        raise ValueError("未识别到刊期表年份")

    digits = "".join(_CHINESE_YEAR_DIGITS[char] for char in chinese_match.group(1))
    return int(digits)


def _extract_remark(text: str) -> str | None:
    match = re.search(r"(备注[:：].+)", text)
    return match.group(1).strip() if match else None


def _extract_schedule_lines(text: str) -> list[str]:
    lines: list[str] = []
    in_table = False
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if "备注" in line:
            break
        if in_table and re.search(r"\d{1,2}\s+(\d{4}|休刊)", line):
            lines.append(line)
        if "日期" in line and "期数" in line:
            in_table = True
    return lines


def _read_month_cells(year: int, lines: list[str]) -> list[list[tuple[int, str]]]:
    month_cells: list[list[tuple[int, str]]] = [[] for _ in range(12)]
    for line in lines:
        next_month = 1
        pairs = re.findall(r"(\d{1,2})\s+(\d{4}|休刊)", line)
        for day_token, value_token in pairs:
            day = int(day_token)
            for month in range(next_month, 13):
                try:
                    candidate = date(year, month, day)
                except ValueError:
                    continue
                if candidate.weekday() == 0:
                    month_cells[month - 1].append((day, value_token))
                    next_month = month + 1
                    break
    return month_cells


def parse_schedule_text(text: str) -> ParsedSchedule:
    """Parse extracted PDF text into annual publication schedule rows."""
    year = extract_year(text)
    month_cells = _read_month_cells(year, _extract_schedule_lines(text))
    rows: list[ScheduleRowDraft] = []

    for month, cells in enumerate(month_cells, start=1):
        for day, issue_token in cells:
            is_suspended = issue_token == "休刊"
            rows.append(
                ScheduleRowDraft(
                    publish_date=date(year, month, day),
                    issue_number=None if is_suspended else int(issue_token),
                    is_suspended=is_suspended,
                )
            )

    rows.sort(key=lambda row: row.publish_date)
    errors = validate_schedule_rows(year, rows)
    return ParsedSchedule(
        year=year,
        rows=rows,
        summary=summarize_rows(rows, _extract_remark(text)),
        errors=errors,
        raw_text=text,
    )


def parse_schedule_pdf(content: bytes) -> ParsedSchedule:
    """Extract text from a PDF and parse it into schedule rows."""
    return parse_schedule_text(extract_pdf_text(content))


def summarize_rows(
    rows: Iterable[ScheduleRowDraft],
    remarks: str | None = None,
) -> ScheduleSummary:
    row_list = list(rows)
    issue_numbers = [
        row.issue_number
        for row in row_list
        if not row.is_suspended and row.issue_number is not None
    ]
    return ScheduleSummary(
        total_rows=len(row_list),
        published_count=len(issue_numbers),
        suspended_count=sum(1 for row in row_list if row.is_suspended),
        first_issue_number=min(issue_numbers) if issue_numbers else None,
        last_issue_number=max(issue_numbers) if issue_numbers else None,
        remarks=remarks,
    )


def validate_schedule_rows(year: int, rows: Iterable[ScheduleRowDraft]) -> list[str]:
    row_list = sorted(rows, key=lambda row: row.publish_date)
    errors: list[str] = []
    seen_dates: set[date] = set()
    previous_issue_number: int | None = None

    for row in row_list:
        if row.publish_date.year != year:
            errors.append(f"{row.publish_date.isoformat()} 不属于 {year} 年")
        if row.publish_date in seen_dates:
            errors.append(f"同一年内出版日期重复：{row.publish_date.isoformat()}")
        seen_dates.add(row.publish_date)

        if row.is_suspended:
            if row.issue_number is not None:
                errors.append(f"{row.publish_date.isoformat()} 是休刊行，不能填写期号")
            continue

        if row.issue_number is None or row.issue_number <= 0:
            errors.append(f"{row.publish_date.isoformat()} 非休刊行必须填写正整数期号")
            continue

        if previous_issue_number is not None and row.issue_number != previous_issue_number + 1:
            expected = previous_issue_number + 1
            errors.append(
                f"期号必须连续递增：{previous_issue_number} 后应为 {expected}，实际为 {row.issue_number}"
            )
        previous_issue_number = row.issue_number

    return errors
```

- [ ] **Step 5: Run parser tests and verify they pass**

Run:

```powershell
cd backend
python -m pytest tests\test_publication_schedule_parser.py -q
```

Expected: PASS with all tests green.

- [ ] **Step 6: Commit parser service**

Run:

```powershell
git add backend\requirements.txt backend\app\services\publication_schedule_parser.py backend\tests\test_publication_schedule_parser.py
git commit -m "feat: parse publication schedule PDFs" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 2: Upload model, migration, and schemas

**Files:**
- Create: `backend/app/models/publication_schedule_upload.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/alembic/versions/3f2b7a9c1d0e_add_publication_schedule_uploads.py`
- Create: `backend/app/schemas/publication_schedule_upload.py`

- [ ] **Step 1: Create upload model**

Create `backend/app/models/publication_schedule_upload.py`:

```python
from sqlalchemy import Column, DateTime, Enum as SAEnum, Integer, JSON, String, Text
from sqlalchemy.sql import func
from app.database import Base
import enum


class PublicationScheduleUploadStatus(str, enum.Enum):
    previewed = "previewed"
    committed = "committed"
    failed = "failed"


class PublicationScheduleUpload(Base):
    __tablename__ = "publication_schedule_uploads"

    id = Column(Integer, primary_key=True, autoincrement=True)
    year = Column(Integer, nullable=False, index=True)
    original_filename = Column(String(255), nullable=False)
    stored_path = Column(String(500), nullable=False)
    status = Column(
        SAEnum(PublicationScheduleUploadStatus),
        default=PublicationScheduleUploadStatus.previewed,
        nullable=False,
        index=True,
    )
    summary_json = Column(JSON, nullable=True)
    error_json = Column(JSON, nullable=True)
    uploaded_by = Column(String(50), nullable=True)
    raw_text = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    committed_at = Column(DateTime, nullable=True)
```

- [ ] **Step 2: Export upload model**

Modify `backend/app/models/__init__.py`:

```python
from app.models.publication_schedule import PublicationSchedule
from app.models.issue import Issue, IssueStatus
from app.models.report_item_template import ReportItemTemplate
from app.models.report_entry import ReportEntry
from app.models.recipient import Recipient, RecipientType, RecipientFrequency, RecipientStatus
from app.models.subscription import Subscription, SubscriptionType
from app.models.shipping_record import ShippingRecord, ShippingStatus
from app.models.user import User, UserRole
from app.models.report_revision import ReportRevision
from app.models.temp_print_detail import TempPrintDetail
from app.models.shipping_detail import ShippingDetail
from app.models.operation_log import OperationLog
from app.models.issue_audit_snapshot import IssueAuditSnapshot
from app.models.publication_schedule_upload import (
    PublicationScheduleUpload,
    PublicationScheduleUploadStatus,
)

__all__ = [
    "PublicationSchedule",
    "Issue", "IssueStatus",
    "ReportItemTemplate",
    "ReportEntry",
    "Recipient", "RecipientType", "RecipientFrequency", "RecipientStatus",
    "Subscription", "SubscriptionType",
    "ShippingRecord", "ShippingStatus",
    "User", "UserRole",
    "ReportRevision",
    "TempPrintDetail",
    "ShippingDetail",
    "OperationLog",
    "IssueAuditSnapshot",
    "PublicationScheduleUpload",
    "PublicationScheduleUploadStatus",
]
```

- [ ] **Step 3: Add migration**

Create `backend/alembic/versions/3f2b7a9c1d0e_add_publication_schedule_uploads.py`:

```python
"""add publication schedule uploads

Revision ID: 3f2b7a9c1d0e
Revises: 6e1b9c4d2a7f
Create Date: 2026-05-22 15:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "3f2b7a9c1d0e"
down_revision: Union[str, None] = "6e1b9c4d2a7f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "publication_schedule_uploads",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("stored_path", sa.String(length=500), nullable=False),
        sa.Column(
            "status",
            sa.Enum("previewed", "committed", "failed", name="publicationscheduleuploadstatus"),
            nullable=False,
        ),
        sa.Column("summary_json", sa.JSON(), nullable=True),
        sa.Column("error_json", sa.JSON(), nullable=True),
        sa.Column("uploaded_by", sa.String(length=50), nullable=True),
        sa.Column("raw_text", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=True),
        sa.Column("committed_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_publication_schedule_uploads_status"), "publication_schedule_uploads", ["status"], unique=False)
    op.create_index(op.f("ix_publication_schedule_uploads_year"), "publication_schedule_uploads", ["year"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_publication_schedule_uploads_year"), table_name="publication_schedule_uploads")
    op.drop_index(op.f("ix_publication_schedule_uploads_status"), table_name="publication_schedule_uploads")
    op.drop_table("publication_schedule_uploads")
```

- [ ] **Step 4: Add upload schemas**

Create `backend/app/schemas/publication_schedule_upload.py`:

```python
from datetime import date, datetime
from pydantic import BaseModel, Field


class ScheduleSummaryOut(BaseModel):
    total_rows: int
    published_count: int
    suspended_count: int
    first_issue_number: int | None
    last_issue_number: int | None
    remarks: str | None = None


class ScheduleRowIn(BaseModel):
    publish_date: date
    issue_number: int | None = Field(default=None, ge=1)
    is_suspended: bool


class SchedulePreviewOut(BaseModel):
    upload_id: int
    year: int
    rows: list[ScheduleRowIn]
    summary: ScheduleSummaryOut
    errors: list[str]
    can_commit: bool


class ScheduleUploadOut(BaseModel):
    id: int
    year: int
    original_filename: str
    status: str
    summary_json: dict | None
    error_json: list[str] | None
    uploaded_by: str | None
    created_at: datetime | None
    committed_at: datetime | None

    model_config = {"from_attributes": True}


class ScheduleCommitIn(BaseModel):
    rows: list[ScheduleRowIn]
```

- [ ] **Step 5: Verify migration imports**

Run:

```powershell
cd backend
python -m alembic heads
```

Expected: command lists `3f2b7a9c1d0e (head)`.

- [ ] **Step 6: Commit model and schemas**

Run:

```powershell
git add backend\app\models\publication_schedule_upload.py backend\app\models\__init__.py backend\app\schemas\publication_schedule_upload.py backend\alembic\versions\3f2b7a9c1d0e_add_publication_schedule_uploads.py
git commit -m "feat: add publication schedule upload model" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 3: Upload service and commit safety

**Files:**
- Create: `backend/app/services/publication_schedule_upload_service.py`
- Create: `backend/tests/test_publication_schedule_upload_service.py`

- [ ] **Step 1: Write commit safety tests**

Create `backend/tests/test_publication_schedule_upload_service.py`:

```python
from datetime import date

import pytest

from app.models import Issue
from app.services.publication_schedule_parser import ScheduleRowDraft
from app.services.publication_schedule_upload_service import ensure_commit_is_safe


class FakeQuery:
    def __init__(self, values):
        self.values = values

    def filter(self, *args):
        return self

    def all(self):
        return self.values


class FakeDb:
    def __init__(self, issues):
        self.issues = issues

    def query(self, model):
        assert model is Issue
        return FakeQuery(self.issues)


def test_ensure_commit_is_safe_allows_matching_existing_issue():
    db = FakeDb([Issue(issue_number=2635, publish_date=date(2026, 1, 5))])

    ensure_commit_is_safe(
        db,
        2026,
        [
            ScheduleRowDraft(date(2026, 1, 5), 2635, False),
            ScheduleRowDraft(date(2026, 1, 12), 2636, False),
        ],
    )


def test_ensure_commit_is_safe_rejects_changed_existing_issue_date():
    db = FakeDb([Issue(issue_number=2635, publish_date=date(2026, 1, 5))])

    with pytest.raises(ValueError) as exc:
        ensure_commit_is_safe(
            db,
            2026,
            [
                ScheduleRowDraft(date(2026, 1, 12), 2635, False),
            ],
        )

    assert "第 2635 期已创建，不能将出版日期从 2026-01-05 改为 2026-01-12" in str(exc.value)


def test_ensure_commit_is_safe_rejects_missing_existing_issue():
    db = FakeDb([Issue(issue_number=2635, publish_date=date(2026, 1, 5))])

    with pytest.raises(ValueError) as exc:
        ensure_commit_is_safe(
            db,
            2026,
            [
                ScheduleRowDraft(date(2026, 1, 12), 2636, False),
            ],
        )

    assert "第 2635 期已创建，不能从刊期表中移除" in str(exc.value)
```

- [ ] **Step 2: Run service tests and verify they fail**

Run:

```powershell
cd backend
python -m pytest tests\test_publication_schedule_upload_service.py -q
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.publication_schedule_upload_service'`.

- [ ] **Step 3: Implement upload service**

Create `backend/app/services/publication_schedule_upload_service.py`:

```python
"""Persist uploaded publication schedule PDFs and commit parsed rows."""

from __future__ import annotations

from dataclasses import asdict
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


def _safe_filename(filename: str) -> str:
    stem = Path(filename).stem or "publication_schedule"
    suffix = Path(filename).suffix.lower() or ".pdf"
    safe_stem = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff._-]+", "_", stem).strip("._")
    return f"{safe_stem or 'publication_schedule'}_{uuid4().hex}{suffix}"


def store_uploaded_pdf(year: int, filename: str, content: bytes) -> str:
    year_dir = UPLOAD_ROOT / str(year)
    year_dir.mkdir(parents=True, exist_ok=True)
    stored_path = year_dir / _safe_filename(filename)
    stored_path.write_bytes(content)
    return str(stored_path.relative_to(UPLOAD_ROOT.parents[1]))


def create_preview_upload(
    db: Session,
    filename: str,
    content_type: str | None,
    content: bytes,
    username: str | None,
) -> tuple[PublicationScheduleUpload, list[ScheduleRowDraft]]:
    if content_type not in {"application/pdf", "application/octet-stream", None} and not filename.lower().endswith(".pdf"):
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
    existing_issues = (
        db.query(Issue)
        .filter(Issue.publish_date >= date(year, 1, 1), Issue.publish_date <= date(year, 12, 31))
        .all()
    )
    row_by_issue = {
        row.issue_number: row
        for row in rows
        if not row.is_suspended and row.issue_number is not None
    }
    for issue in existing_issues:
        matching_row = row_by_issue.get(issue.issue_number)
        if matching_row is None:
            raise ValueError(f"第 {issue.issue_number} 期已创建，不能从刊期表中移除")
        if matching_row.publish_date != issue.publish_date:
            raise ValueError(
                f"第 {issue.issue_number} 期已创建，不能将出版日期从 "
                f"{issue.publish_date.isoformat()} 改为 {matching_row.publish_date.isoformat()}"
            )


def commit_schedule_upload(
    db: Session,
    upload_id: int,
    rows: list[ScheduleRowDraft],
) -> PublicationScheduleUpload:
    upload = db.query(PublicationScheduleUpload).filter(PublicationScheduleUpload.id == upload_id).first()
    if upload is None:
        raise ValueError("上传记录不存在")

    errors = validate_schedule_rows(upload.year, rows)
    if errors:
        upload.status = PublicationScheduleUploadStatus.failed
        upload.error_json = errors
        db.commit()
        raise ValueError("；".join(errors))

    ensure_commit_is_safe(db, upload.year, rows)
    db.query(PublicationSchedule).filter(PublicationSchedule.year == upload.year).delete()
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
    upload.summary_json = asdict(summarize_rows(rows, (upload.summary_json or {}).get("remarks")))
    upload.error_json = []
    upload.committed_at = datetime.now()
    db.commit()
    db.refresh(upload)
    invalidate_dashboard_cache()
    return upload
```

- [ ] **Step 4: Run parser and service tests**

Run:

```powershell
cd backend
python -m pytest tests\test_publication_schedule_parser.py tests\test_publication_schedule_upload_service.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit upload service**

Run:

```powershell
git add backend\app\services\publication_schedule_upload_service.py backend\tests\test_publication_schedule_upload_service.py
git commit -m "feat: commit publication schedule uploads" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 4: Schedule API endpoints

**Files:**
- Modify: `backend/app/api/schedule.py`

- [ ] **Step 1: Replace schedule API with list, preview, and commit routes**

Modify `backend/app/api/schedule.py` to:

```python
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session
from typing import List

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import PublicationSchedule, PublicationScheduleUpload, User
from app.schemas.publication_schedule_upload import (
    ScheduleCommitIn,
    SchedulePreviewOut,
    ScheduleRowIn,
    ScheduleSummaryOut,
    ScheduleUploadOut,
)
from app.schemas.schedule import ScheduleEntry
from app.services.publication_schedule_parser import ScheduleRowDraft
from app.services.publication_schedule_upload_service import (
    commit_schedule_upload,
    create_preview_upload,
)

router = APIRouter(prefix="/api/schedule", tags=["schedule"])


@router.get("", response_model=List[ScheduleEntry])
def list_schedule(year: int = 2026, db: Session = Depends(get_db)):
    return (
        db.query(PublicationSchedule)
        .filter(PublicationSchedule.year == year)
        .order_by(PublicationSchedule.publish_date)
        .all()
    )


@router.get("/uploads", response_model=list[ScheduleUploadOut])
def list_schedule_uploads(
    year: int | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(PublicationScheduleUpload)
    if year is not None:
        query = query.filter(PublicationScheduleUpload.year == year)
    return query.order_by(PublicationScheduleUpload.created_at.desc()).all()


@router.post("/uploads/preview", response_model=SchedulePreviewOut)
async def preview_schedule_upload(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Upload a PDF and parse schedule rows without writing final schedule data."""
    try:
        content = await file.read()
        upload, rows = create_preview_upload(
            db,
            file.filename or "publication_schedule.pdf",
            file.content_type,
            content,
            user.username,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    summary = upload.summary_json or {}
    errors = upload.error_json or []
    return SchedulePreviewOut(
        upload_id=upload.id,
        year=upload.year,
        rows=[
            ScheduleRowIn(
                publish_date=row.publish_date,
                issue_number=row.issue_number,
                is_suspended=row.is_suspended,
            )
            for row in rows
        ],
        summary=ScheduleSummaryOut(**summary),
        errors=errors,
        can_commit=len(errors) == 0,
    )


@router.post("/uploads/{upload_id}/commit", response_model=ScheduleUploadOut)
def commit_schedule_upload_endpoint(
    upload_id: int,
    body: ScheduleCommitIn,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Persist confirmed schedule rows from an upload into publication_schedule."""
    rows = [
        ScheduleRowDraft(
            publish_date=row.publish_date,
            issue_number=None if row.is_suspended else row.issue_number,
            is_suspended=row.is_suspended,
        )
        for row in body.rows
    ]
    try:
        return commit_schedule_upload(db, upload_id, rows)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
```

- [ ] **Step 2: Run backend import check**

Run:

```powershell
cd backend
python -c "from app.api.schedule import router; print(router.prefix)"
```

Expected: prints `/api/schedule`.

- [ ] **Step 3: Run backend tests**

Run:

```powershell
cd backend
python -m pytest tests\test_publication_schedule_parser.py tests\test_publication_schedule_upload_service.py -q
```

Expected: PASS.

- [ ] **Step 4: Commit API routes**

Run:

```powershell
git add backend\app\api\schedule.py
git commit -m "feat: expose publication schedule upload API" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 5: Frontend API client and pure helpers

**Files:**
- Create: `frontend/src/api/schedule.ts`
- Create: `frontend/src/pages/publicationScheduleUtils.ts`
- Create: `frontend/src/pages/publicationScheduleUtils.test.ts`

- [ ] **Step 1: Create frontend schedule API client**

Create `frontend/src/api/schedule.ts`:

```ts
import api from './client';

export interface ScheduleEntry {
  id: number;
  year: number;
  issue_number: number | null;
  publish_date: string;
  is_suspended: boolean;
}

export interface ScheduleSummary {
  total_rows: number;
  published_count: number;
  suspended_count: number;
  first_issue_number: number | null;
  last_issue_number: number | null;
  remarks?: string | null;
}

export interface ScheduleDraftRow {
  publish_date: string;
  issue_number: number | null;
  is_suspended: boolean;
}

export interface SchedulePreview {
  upload_id: number;
  year: number;
  rows: ScheduleDraftRow[];
  summary: ScheduleSummary;
  errors: string[];
  can_commit: boolean;
}

export interface ScheduleUpload {
  id: number;
  year: number;
  original_filename: string;
  status: 'previewed' | 'committed' | 'failed';
  summary_json: ScheduleSummary | null;
  error_json: string[] | null;
  uploaded_by: string | null;
  created_at: string | null;
  committed_at: string | null;
}

export const getSchedule = (year: number) =>
  api.get<ScheduleEntry[]>('/schedule', { params: { year } });

export const getScheduleUploads = (year?: number) =>
  api.get<ScheduleUpload[]>('/schedule/uploads', { params: year ? { year } : undefined });

export const previewScheduleUpload = (file: File) => {
  const form = new FormData();
  form.append('file', file);
  return api.post<SchedulePreview>('/schedule/uploads/preview', form);
};

export const commitScheduleUpload = (uploadId: number, rows: ScheduleDraftRow[]) =>
  api.post<ScheduleUpload>(`/schedule/uploads/${uploadId}/commit`, { rows });
```

- [ ] **Step 2: Create testable helper functions**

Create `frontend/src/pages/publicationScheduleUtils.ts`:

```ts
import dayjs from 'dayjs';
import type { ScheduleDraftRow, ScheduleEntry, ScheduleSummary } from '../api/schedule';

export interface ScheduleMonthGroup<T> {
  month: number;
  rows: T[];
}

type RowWithDate = { publish_date: string };

export function groupScheduleRowsByMonth<T extends RowWithDate>(rows: T[]): ScheduleMonthGroup<T>[] {
  const groups = new Map<number, T[]>();
  [...rows]
    .sort((a, b) => a.publish_date.localeCompare(b.publish_date))
    .forEach((row) => {
      const month = dayjs(row.publish_date).month() + 1;
      groups.set(month, [...(groups.get(month) ?? []), row]);
    });

  return Array.from(groups.entries()).map(([month, groupedRows]) => ({
    month,
    rows: groupedRows,
  }));
}

export function summarizeScheduleRows(rows: Array<ScheduleDraftRow | ScheduleEntry>): ScheduleSummary {
  const published = rows.filter((row) => !row.is_suspended && row.issue_number !== null);
  const issueNumbers = published.map((row) => Number(row.issue_number));
  return {
    total_rows: rows.length,
    published_count: published.length,
    suspended_count: rows.filter((row) => row.is_suspended).length,
    first_issue_number: issueNumbers.length > 0 ? Math.min(...issueNumbers) : null,
    last_issue_number: issueNumbers.length > 0 ? Math.max(...issueNumbers) : null,
  };
}

export function rowHasError(row: ScheduleDraftRow, errors: string[]): boolean {
  return errors.some((error) => error.includes(row.publish_date));
}
```

- [ ] **Step 3: Write helper tests**

Create `frontend/src/pages/publicationScheduleUtils.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  groupScheduleRowsByMonth,
  rowHasError,
  summarizeScheduleRows,
} from './publicationScheduleUtils';

describe('publicationScheduleUtils', () => {
  it('groups schedule rows by month and sorts within each group', () => {
    const groups = groupScheduleRowsByMonth([
      { publish_date: '2026-02-09', issue_number: 2640, is_suspended: false },
      { publish_date: '2026-01-12', issue_number: 2636, is_suspended: false },
      { publish_date: '2026-01-05', issue_number: 2635, is_suspended: false },
    ]);

    expect(groups).toEqual([
      {
        month: 1,
        rows: [
          { publish_date: '2026-01-05', issue_number: 2635, is_suspended: false },
          { publish_date: '2026-01-12', issue_number: 2636, is_suspended: false },
        ],
      },
      {
        month: 2,
        rows: [
          { publish_date: '2026-02-09', issue_number: 2640, is_suspended: false },
        ],
      },
    ]);
  });

  it('summarizes published and suspended rows', () => {
    expect(summarizeScheduleRows([
      { publish_date: '2026-01-05', issue_number: 2635, is_suspended: false },
      { publish_date: '2026-02-16', issue_number: null, is_suspended: true },
      { publish_date: '2026-03-02', issue_number: 2641, is_suspended: false },
    ])).toEqual({
      total_rows: 3,
      published_count: 2,
      suspended_count: 1,
      first_issue_number: 2635,
      last_issue_number: 2641,
    });
  });

  it('detects errors that mention a row date', () => {
    expect(rowHasError(
      { publish_date: '2026-02-16', issue_number: null, is_suspended: true },
      ['2026-02-16 是休刊行，不能填写期号'],
    )).toBe(true);
  });
});
```

- [ ] **Step 4: Run helper tests**

Run:

```powershell
cd frontend
npm run test -- publicationScheduleUtils.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit frontend API and helpers**

Run:

```powershell
git add frontend\src\api\schedule.ts frontend\src\pages\publicationScheduleUtils.ts frontend\src\pages\publicationScheduleUtils.test.ts
git commit -m "feat: add schedule upload frontend helpers" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 6: Frontend management page and navigation

**Files:**
- Create: `frontend/src/pages/PublicationScheduleManager.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/AppLayout.tsx`

- [ ] **Step 1: Create management page**

Create `frontend/src/pages/PublicationScheduleManager.tsx`:

```tsx
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  InputNumber,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Upload,
  message,
} from 'antd';
import { InboxOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { ColumnsType } from 'antd/es/table';
import type { ScheduleDraftRow, ScheduleEntry, SchedulePreview } from '../api/schedule';
import {
  commitScheduleUpload,
  getSchedule,
  getScheduleUploads,
  previewScheduleUpload,
} from '../api/schedule';
import { groupScheduleRowsByMonth, rowHasError, summarizeScheduleRows } from './publicationScheduleUtils';
import { useAuth } from '../contexts/AuthContext';

const { Dragger } = Upload;

export default function PublicationScheduleManager() {
  const currentYear = dayjs().year();
  const [year, setYear] = useState(2026);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [previewRows, setPreviewRows] = useState<ScheduleDraftRow[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();

  const scheduleQuery = useQuery({
    queryKey: ['schedule', year],
    queryFn: async () => (await getSchedule(year)).data,
  });

  const uploadsQuery = useQuery({
    queryKey: ['scheduleUploads', year],
    queryFn: async () => (await getScheduleUploads(year)).data,
  });

  const finalRows = scheduleQuery.data ?? [];
  const displaySummary = preview
    ? summarizeScheduleRows(previewRows)
    : summarizeScheduleRows(finalRows);

  const handlePreview = async () => {
    if (!file) {
      message.warning('请先选择刊期表 PDF');
      return;
    }
    setPreviewing(true);
    setPreview(null);
    setPreviewRows([]);
    try {
      const res = await previewScheduleUpload(file);
      setYear(res.data.year);
      setPreview(res.data);
      setPreviewRows(res.data.rows);
      message.success('刊期表解析完成，请核对预览');
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } };
      message.error(err.response?.data?.detail || '解析失败');
    } finally {
      setPreviewing(false);
    }
  };

  const handleRowChange = (index: number, nextRow: Partial<ScheduleDraftRow>) => {
    setPreviewRows((rows) => rows.map((row, rowIndex) => (
      rowIndex === index
        ? {
            ...row,
            ...nextRow,
            issue_number: nextRow.is_suspended ? null : (nextRow.issue_number ?? row.issue_number),
          }
        : row
    )));
  };

  const handleCommit = async () => {
    if (!preview) return;
    setCommitting(true);
    try {
      await commitScheduleUpload(preview.upload_id, previewRows);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['schedule'] }),
        queryClient.invalidateQueries({ queryKey: ['scheduleUploads'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['issues'] }),
      ]);
      setPreview(null);
      setPreviewRows([]);
      setFile(null);
      message.success(`${year} 年刊期表已保存`);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } };
      message.error(err.response?.data?.detail || '保存失败');
    } finally {
      setCommitting(false);
    }
  };

  const finalColumns: ColumnsType<ScheduleEntry> = [
    {
      title: '出版日期',
      dataIndex: 'publish_date',
      render: (value: string) => dayjs(value).format('YYYY-MM-DD'),
    },
    {
      title: '期号',
      dataIndex: 'issue_number',
      render: (value: number | null, row) => row.is_suspended ? <Tag color="default">休刊</Tag> : `第 ${value} 期`,
    },
  ];

  const previewColumns: ColumnsType<ScheduleDraftRow & { rowIndex: number }> = [
    {
      title: '出版日期',
      dataIndex: 'publish_date',
      render: (value: string, row) => (
        <DatePicker
          value={dayjs(value)}
          onChange={(nextDate) => handleRowChange(row.rowIndex, { publish_date: nextDate?.format('YYYY-MM-DD') ?? value })}
        />
      ),
    },
    {
      title: '休刊',
      dataIndex: 'is_suspended',
      render: (value: boolean, row) => (
        <Switch
          checked={value}
          checkedChildren="休刊"
          unCheckedChildren="出版"
          onChange={(checked) => handleRowChange(row.rowIndex, { is_suspended: checked })}
        />
      ),
    },
    {
      title: '期号',
      dataIndex: 'issue_number',
      render: (value: number | null, row) => (
        <InputNumber
          min={1}
          disabled={row.is_suspended}
          value={value}
          onChange={(nextValue) => handleRowChange(row.rowIndex, { issue_number: nextValue })}
        />
      ),
    },
  ];

  const previewRowsWithIndex = previewRows.map((row, rowIndex) => ({ ...row, rowIndex }));
  const rowsForDisplay = preview ? previewRowsWithIndex : finalRows;
  const monthGroups = groupScheduleRowsByMonth(rowsForDisplay);

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto' }}>
      <h1 style={{
        fontSize: 28,
        fontWeight: 700,
        color: 'var(--color-text-primary)',
        margin: '0 0 32px 0',
        letterSpacing: '-0.02em',
      }}>
        刊期表管理
      </h1>

      <Card style={{ marginBottom: 24 }}>
        <Space align="center" wrap>
          <span style={{ color: 'var(--color-text-secondary)' }}>年份</span>
          <Select
            value={year}
            style={{ width: 140 }}
            onChange={(value) => {
              setYear(value);
              setPreview(null);
              setPreviewRows([]);
            }}
            options={[currentYear - 1, currentYear, currentYear + 1, 2026]
              .filter((value, index, arr) => arr.indexOf(value) === index)
              .sort()
              .map((value) => ({ label: `${value} 年`, value }))}
          />
        </Space>
      </Card>

      <Card style={{ marginBottom: 24 }}>
        <Space size={24} wrap>
          <Statistic title="计划周数" value={displaySummary.total_rows} />
          <Statistic title="出版期数" value={displaySummary.published_count} />
          <Statistic title="休刊次数" value={displaySummary.suspended_count} />
          <Statistic
            title="期号范围"
            value={
              displaySummary.first_issue_number && displaySummary.last_issue_number
                ? `${displaySummary.first_issue_number}-${displaySummary.last_issue_number}`
                : '-'
            }
          />
        </Space>
      </Card>

      {isAdmin && (
        <Card title="上传刊期表 PDF" style={{ marginBottom: 24 }}>
          <Dragger
            accept=".pdf,application/pdf"
            maxCount={1}
            beforeUpload={() => false}
            onChange={({ fileList }) => setFile(fileList[0]?.originFileObj ?? null)}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">点击或拖拽上传年度刊期表 PDF</p>
            <p className="ant-upload-hint">上传后先预览，确认无误再保存</p>
          </Dragger>
          <Button
            type="primary"
            icon={<UploadOutlined />}
            style={{ marginTop: 16 }}
            onClick={handlePreview}
            loading={previewing}
          >
            解析并预览
          </Button>
        </Card>
      )}

      {preview && (
        <Card title="解析预览" style={{ marginBottom: 24 }}>
          {preview.errors.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="解析结果需要核对"
              description={preview.errors.join('；')}
            />
          )}
          <Button
            type="primary"
            onClick={handleCommit}
            loading={committing}
            style={{ marginBottom: 16 }}
          >
            确认保存
          </Button>
        </Card>
      )}

      {monthGroups.map((group) => (
        <Card key={group.month} title={`${group.month}月`} style={{ marginBottom: 20 }}>
          <Table
            rowKey={(row) => `${row.publish_date}-${'rowIndex' in row ? row.rowIndex : row.id}`}
            dataSource={group.rows}
            columns={preview ? previewColumns : finalColumns}
            pagination={false}
            rowClassName={(row) => (
              preview && rowHasError(row as ScheduleDraftRow, preview.errors)
                ? 'ant-table-row-selected'
                : ''
            )}
          />
        </Card>
      ))}

      <Card title="上传记录" loading={uploadsQuery.isLoading}>
        <Table
          rowKey="id"
          dataSource={uploadsQuery.data ?? []}
          pagination={false}
          columns={[
            { title: '文件名', dataIndex: 'original_filename' },
            { title: '状态', dataIndex: 'status' },
            { title: '上传人', dataIndex: 'uploaded_by' },
            {
              title: '上传时间',
              dataIndex: 'created_at',
              render: (value: string | null) => value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-',
            },
          ]}
        />
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Add route**

Modify `frontend/src/App.tsx` imports and routes:

```tsx
import PublicationScheduleManager from './pages/PublicationScheduleManager';
```

Add inside the authenticated route group:

```tsx
<Route path="/schedule" element={<PublicationScheduleManager />} />
```

- [ ] **Step 3: Add sidebar navigation**

Modify `frontend/src/components/AppLayout.tsx`:

```tsx
import { DashboardOutlined, UserOutlined, HistoryOutlined, SettingOutlined, LogoutOutlined, CalendarOutlined } from '@ant-design/icons';
```

Add to `menuItems`:

```tsx
{ key: '/schedule', icon: <CalendarOutlined />, label: '刊期表管理' },
```

Add selected-key mapping:

```tsx
if (path.startsWith('/schedule')) return '/schedule';
```

- [ ] **Step 4: Run frontend type check**

Run:

```powershell
cd frontend
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit management page**

Run:

```powershell
git add frontend\src\pages\PublicationScheduleManager.tsx frontend\src\App.tsx frontend\src\components\AppLayout.tsx
git commit -m "feat: add publication schedule management page" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 7: Documentation and end-to-end verification

**Files:**
- Modify: `README.md`
- Modify: `docs/technical.md`
- Modify: `docs/requirements.md`
- Modify: `docs/user-guide.md`

- [ ] **Step 1: Update README workflow section**

Add a short section after the initialization/import workflow:

```markdown
## 年度刊期表管理

管理员可在「刊期表管理」中上传年度刊期表 PDF。系统会先解析 PDF 并展示可编辑预览，确认无误后保存为结构化刊期数据；保存后的刊期表会驱动首页的下一期创建和补录期次选择。上传原始 PDF 会保留在后端用于追溯。
```

- [ ] **Step 2: Update technical documentation**

In `docs/technical.md`, update the API/model sections with:

```markdown
### publication_schedule_uploads（年度刊期表上传记录）

记录管理员上传的年度刊期表 PDF 及解析结果。最终可创建期次仍以 `publication_schedule` 为准。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| year | INT | 刊期年份 |
| original_filename | VARCHAR(255) | 上传文件名 |
| stored_path | VARCHAR(500) | 后端相对存储路径 |
| status | ENUM | previewed/committed/failed |
| summary_json | JSON | 解析摘要 |
| error_json | JSON | 解析或校验错误 |
| uploaded_by | VARCHAR(50) | 上传用户 |
| raw_text | TEXT | PDF 抽取文本 |
| created_at | DATETIME | 上传时间 |
| committed_at | DATETIME | 确认保存时间 |

### 刊期表上传 API

- `GET /api/schedule?year=YYYY`：查询最终刊期表。
- `GET /api/schedule/uploads?year=YYYY`：查询上传记录。
- `POST /api/schedule/uploads/preview`：上传 PDF 并解析预览，不写入最终刊期表。
- `POST /api/schedule/uploads/{upload_id}/commit`：确认保存预览行，写入 `publication_schedule`。
```

- [ ] **Step 3: Update requirements**

In `docs/requirements.md`, add:

```markdown
## 年度刊期表管理

- 管理员可以上传年度刊期表 PDF。
- 系统解析年份、出版日期、期号和休刊状态，并生成可编辑预览。
- 用户确认保存后，结构化刊期数据进入 `publication_schedule`。
- 休刊周不占用期号，非休刊期号必须连续递增。
- 当某年已有报数期次时，系统禁止覆盖会改变既有期号或出版日期的数据。
```

- [ ] **Step 4: Update user guide**

In `docs/user-guide.md`, add:

```markdown
## 年度刊期表上传

1. 使用管理员账号登录。
2. 打开「刊期表管理」。
3. 选择或确认年份。
4. 点击或拖拽上传年度刊期表 PDF。
5. 上传后系统自动解析并显示预览。
6. 核对系统识别出的出版日期、期号和休刊状态。
7. 如有识别错误，不要保存；修正 PDF 后重新上传。
8. 点击「确认保存」。

保存后，首页创建本期报数和选择其他期数补录会自动使用新的年度刊期表。
```

- [ ] **Step 5: Run backend verification**

Run:

```powershell
cd backend
python -m pytest tests\test_publication_schedule_parser.py tests\test_publication_schedule_upload_service.py -q
python -m alembic heads
```

Expected: tests PASS and Alembic head is `3f2b7a9c1d0e`.

- [ ] **Step 6: Run frontend verification**

Run:

```powershell
cd frontend
npm run test -- publicationScheduleUtils.test.ts
npx tsc --noEmit
```

Expected: tests PASS and TypeScript exits with code 0.

- [ ] **Step 7: Commit documentation**

Run:

```powershell
git add README.md docs\technical.md docs\requirements.md docs\user-guide.md
git commit -m "docs: document publication schedule uploads" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Self-Review

- Spec coverage:
  - PDF upload and parsing: Tasks 1, 3, 4, 6.
  - Original file and upload record persistence: Tasks 2, 3, 4, 6.
  - Preview and manual correction: Tasks 4 and 6.
  - Dashboard/issue creation integration: Task 3 invalidates dashboard cache; Task 6 invalidates frontend `dashboard`, `issues`, and `schedule` queries.
  - Existing issue safety: Task 3 tests and service.
  - Admin-only writes and operator read-only access: Task 4 uses `require_admin` for preview/commit; Task 6 hides upload UI for non-admin.
  - Documentation: Task 7.
- Placeholder scan: No unresolved placeholder text is present.
- Type consistency: Backend row type is `ScheduleRowDraft`; API row schema is `ScheduleRowIn`; frontend row type is `ScheduleDraftRow`. Property names consistently use `publish_date`, `issue_number`, and `is_suspended`.
