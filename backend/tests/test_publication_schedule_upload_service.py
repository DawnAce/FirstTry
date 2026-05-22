from datetime import date

import pytest

from app.models import Issue, PublicationScheduleUploadStatus
from app.services.publication_schedule_parser import (
    ParsedSchedule,
    ScheduleRowDraft,
    ScheduleSummary,
)
from app.services import publication_schedule_upload_service as service


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

    service.ensure_commit_is_safe(
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
        service.ensure_commit_is_safe(
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
        service.ensure_commit_is_safe(
            db,
            2026,
            [
                ScheduleRowDraft(date(2026, 1, 12), 2636, False),
            ],
        )

    assert "第 2635 期已创建，不能从刊期表中移除" in str(exc.value)


def test_safe_filename_sanitizes_unsafe_characters_and_preserves_pdf_suffix(monkeypatch):
    class FakeUuid:
        hex = "abc123"

    monkeypatch.setattr(service, "uuid4", lambda: FakeUuid())

    filename = service._safe_filename("../刊期表*最终?.PDF")

    assert filename == "刊期表_最终_abc123.pdf"


def test_safe_filename_caps_final_basename_length_for_long_pdf_name(monkeypatch):
    class FakeUuid:
        hex = "a" * 32

    monkeypatch.setattr(service, "uuid4", lambda: FakeUuid())

    filename = service._safe_filename(f"{'x' * 251}.PDF")

    assert len(filename) <= 255
    assert filename.endswith(f"_{FakeUuid.hex}.pdf")


def test_store_uploaded_pdf_writes_bytes_and_returns_relative_upload_path(tmp_path, monkeypatch):
    upload_root = tmp_path / "uploads" / "publication_schedules"
    monkeypatch.setattr(service, "UPLOAD_ROOT", upload_root)
    monkeypatch.setattr(service, "_safe_filename", lambda filename: "safe.pdf")

    stored_path = service.store_uploaded_pdf(2026, "unsafe.pdf", b"pdf-bytes")

    assert (upload_root / "2026" / "safe.pdf").read_bytes() == b"pdf-bytes"
    assert "uploads" in stored_path
    assert "publication_schedules" in stored_path
    assert stored_path.endswith("2026/safe.pdf")


def test_store_uploaded_pdf_returns_posix_path(tmp_path, monkeypatch):
    upload_root = tmp_path / "uploads" / "publication_schedules"
    monkeypatch.setattr(service, "UPLOAD_ROOT", upload_root)
    monkeypatch.setattr(service, "_safe_filename", lambda filename: "safe.pdf")

    stored_path = service.store_uploaded_pdf(2026, "unsafe.pdf", b"pdf-bytes")

    assert "/" in stored_path
    assert "\\" not in stored_path


def test_create_preview_upload_rejects_non_pdf_filename_and_content_type():
    with pytest.raises(ValueError) as exc:
        service.create_preview_upload(
            FakeDb([]),
            "schedule.txt",
            "text/plain",
            b"content",
            "alice",
        )

    assert str(exc.value) == "请上传 PDF 文件"


def test_create_preview_upload_rejects_exe_filename_with_pdf_content_type():
    with pytest.raises(ValueError) as exc:
        service.create_preview_upload(
            FakeDb([]),
            "schedule.exe",
            "application/pdf",
            b"content",
            "alice",
        )

    assert str(exc.value) == "请上传 PDF 文件"


def test_create_preview_upload_rejects_double_extension_with_pdf_content_type():
    with pytest.raises(ValueError) as exc:
        service.create_preview_upload(
            FakeDb([]),
            "schedule.pdf.exe",
            "application/pdf",
            b"content",
            "alice",
        )

    assert str(exc.value) == "请上传 PDF 文件"


def test_create_preview_upload_rejects_pdf_filename_with_non_pdf_content_type():
    with pytest.raises(ValueError) as exc:
        service.create_preview_upload(
            FakeDb([]),
            "schedule.pdf",
            "text/plain",
            b"content",
            "alice",
        )

    assert str(exc.value) == "请上传 PDF 文件"


def test_create_preview_upload_rejects_empty_pdf_content():
    with pytest.raises(ValueError) as exc:
        service.create_preview_upload(
            FakeDb([]),
            "schedule.pdf",
            "application/pdf",
            b"",
            "alice",
        )

    assert str(exc.value) == "上传文件为空"


class FakeWriteDb:
    def __init__(self):
        self.added = None
        self.committed = False
        self.refreshed = None

    def add(self, obj):
        self.added = obj

    def commit(self):
        self.committed = True

    def refresh(self, obj):
        self.refreshed = obj

    def rollback(self):
        self.rolled_back = True


def make_parsed_schedule():
    rows = [ScheduleRowDraft(date(2026, 1, 5), 2635, False)]
    return ParsedSchedule(
        year=2026,
        raw_text="raw text",
        rows=rows,
        summary=ScheduleSummary(
            total_rows=1,
            published_count=1,
            suspended_count=0,
            first_issue_number=2635,
            last_issue_number=2635,
            remarks=None,
        ),
        errors=["warning"],
    )


def test_create_preview_upload_creates_preview_record(tmp_path, monkeypatch):
    parsed = make_parsed_schedule()
    upload_root = tmp_path / "uploads" / "publication_schedules"
    monkeypatch.setattr(service, "UPLOAD_ROOT", upload_root)
    monkeypatch.setattr(service, "_safe_filename", lambda filename: "stored.pdf")
    monkeypatch.setattr(service, "parse_schedule_pdf", lambda content: parsed)
    db = FakeWriteDb()

    upload, returned_rows = service.create_preview_upload(
        db,
        "schedule.pdf",
        "application/pdf",
        b"pdf-content",
        "alice",
    )

    assert returned_rows == parsed.rows
    assert db.added is upload
    assert db.committed is True
    assert db.refreshed is upload
    assert upload.year == 2026
    assert upload.original_filename == "schedule.pdf"
    assert upload.stored_path.endswith("2026/stored.pdf")
    assert upload.status == PublicationScheduleUploadStatus.previewed
    assert upload.summary_json == {
        "total_rows": 1,
        "published_count": 1,
        "suspended_count": 0,
        "first_issue_number": 2635,
        "last_issue_number": 2635,
        "remarks": None,
    }
    assert upload.error_json == ["warning"]
    assert upload.uploaded_by == "alice"
    assert upload.raw_text == "raw text"
    assert (upload_root / "2026" / "stored.pdf").read_bytes() == b"pdf-content"


@pytest.mark.parametrize("filename", [None, "", "   "])
def test_create_preview_upload_uses_default_original_filename_for_missing_or_blank_filename(
    tmp_path, monkeypatch, filename
):
    parsed = make_parsed_schedule()
    upload_root = tmp_path / "uploads" / "publication_schedules"
    monkeypatch.setattr(service, "UPLOAD_ROOT", upload_root)
    monkeypatch.setattr(service, "_safe_filename", lambda filename: "stored.pdf")
    monkeypatch.setattr(service, "parse_schedule_pdf", lambda content: parsed)
    db = FakeWriteDb()

    upload, _ = service.create_preview_upload(
        db,
        filename,
        "application/pdf",
        b"pdf-content",
        "alice",
    )

    assert upload.original_filename == "publication_schedule.pdf"


def test_create_preview_upload_rejects_overlong_filename_before_writing(tmp_path, monkeypatch):
    upload_root = tmp_path / "uploads" / "publication_schedules"
    monkeypatch.setattr(service, "UPLOAD_ROOT", upload_root)
    monkeypatch.setattr(service, "parse_schedule_pdf", lambda content: make_parsed_schedule())

    with pytest.raises(ValueError) as exc:
        service.create_preview_upload(
            FakeWriteDb(),
            f"{'a' * 252}.pdf",
            "application/pdf",
            b"pdf-content",
            "alice",
        )

    assert str(exc.value) == "文件名不能超过 255 个字符"
    assert not upload_root.exists()


def test_create_preview_upload_rejects_overlong_username_before_writing(tmp_path, monkeypatch):
    upload_root = tmp_path / "uploads" / "publication_schedules"
    monkeypatch.setattr(service, "UPLOAD_ROOT", upload_root)
    monkeypatch.setattr(service, "parse_schedule_pdf", lambda content: make_parsed_schedule())

    with pytest.raises(ValueError) as exc:
        service.create_preview_upload(
            FakeWriteDb(),
            "schedule.pdf",
            "application/pdf",
            b"pdf-content",
            "a" * 51,
        )

    assert str(exc.value) == "上传用户名不能超过 50 个字符"
    assert not upload_root.exists()


class FailingCommitDb(FakeWriteDb):
    def __init__(self):
        super().__init__()
        self.rolled_back = False
        self.commit_error = RuntimeError("commit failed")

    def commit(self):
        raise self.commit_error


class FailingAddDb(FakeWriteDb):
    def __init__(self):
        super().__init__()
        self.rolled_back = False
        self.add_error = RuntimeError("add failed")

    def add(self, obj):
        raise self.add_error


def test_create_preview_upload_rolls_back_and_deletes_file_on_commit_failure(
    tmp_path, monkeypatch
):
    parsed = make_parsed_schedule()
    upload_root = tmp_path / "uploads" / "publication_schedules"
    monkeypatch.setattr(service, "UPLOAD_ROOT", upload_root)
    monkeypatch.setattr(service, "_safe_filename", lambda filename: "stored.pdf")
    monkeypatch.setattr(service, "parse_schedule_pdf", lambda content: parsed)
    db = FailingCommitDb()

    with pytest.raises(RuntimeError) as exc:
        service.create_preview_upload(
            db,
            "schedule.pdf",
            "application/pdf",
            b"pdf-content",
            "alice",
        )

    assert exc.value is db.commit_error
    assert db.rolled_back is True
    assert not (upload_root / "2026" / "stored.pdf").exists()


def test_create_preview_upload_rolls_back_and_deletes_file_on_add_failure(
    tmp_path, monkeypatch
):
    parsed = make_parsed_schedule()
    upload_root = tmp_path / "uploads" / "publication_schedules"
    monkeypatch.setattr(service, "UPLOAD_ROOT", upload_root)
    monkeypatch.setattr(service, "_safe_filename", lambda filename: "stored.pdf")
    monkeypatch.setattr(service, "parse_schedule_pdf", lambda content: parsed)
    db = FailingAddDb()

    with pytest.raises(RuntimeError) as exc:
        service.create_preview_upload(
            db,
            "schedule.pdf",
            "application/pdf",
            b"pdf-content",
            "alice",
        )

    assert exc.value is db.add_error
    assert db.rolled_back is True
    assert not (upload_root / "2026" / "stored.pdf").exists()
