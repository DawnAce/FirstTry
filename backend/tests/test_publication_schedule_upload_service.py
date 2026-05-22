import asyncio
from datetime import date
from pathlib import Path

import pytest

from app.models import (
    Issue,
    PublicationSchedule,
    PublicationScheduleUpload,
    PublicationScheduleUploadStatus,
)
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


def test_safe_filename_caps_final_basename_utf8_bytes_for_long_chinese_pdf_name(
    monkeypatch,
):
    class FakeUuid:
        hex = "a" * 32

    monkeypatch.setattr(service, "uuid4", lambda: FakeUuid())

    filename = service._safe_filename(f"{'刊' * 251}.PDF")
    basename = Path(filename).name

    assert len(basename.encode("utf-8")) <= 255
    assert filename.endswith(f"_{FakeUuid.hex}.pdf")
    assert Path(filename).suffix == ".pdf"


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


def test_create_preview_upload_rejects_oversized_pdf_before_parsing_or_writing(
    tmp_path, monkeypatch
):
    upload_root = tmp_path / "uploads" / "publication_schedules"
    monkeypatch.setattr(service, "UPLOAD_ROOT", upload_root)
    monkeypatch.setattr(
        service,
        "parse_schedule_pdf",
        lambda content: pytest.fail("oversized content must be rejected before parsing"),
    )

    with pytest.raises(ValueError) as exc:
        service.create_preview_upload(
            FakeDb([]),
            "schedule.pdf",
            "application/pdf",
            b"x" * (10 * 1024 * 1024 + 1),
            "alice",
        )

    assert str(exc.value) == "PDF 文件不能超过 10 MB"
    assert not upload_root.exists()


def test_read_limited_upload_rejects_oversized_pdf_after_bounded_read():
    from app.api import schedule as schedule_api

    class FakeUploadFile:
        def __init__(self):
            self.requested_sizes = []

        async def read(self, size=-1):
            self.requested_sizes.append(size)
            return b"x" * size

    file = FakeUploadFile()

    with pytest.raises(ValueError) as exc:
        asyncio.run(schedule_api.read_limited_upload(file))

    assert str(exc.value) == "PDF 文件不能超过 10 MB"
    assert file.requested_sizes == [service.MAX_PDF_UPLOAD_BYTES + 1]


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
    rows = [
        ScheduleRowDraft(date(2026, 1, 5), 2635, False),
        ScheduleRowDraft(date(2026, 2, 16), None, True),
    ]
    return ParsedSchedule(
        year=2026,
        raw_text="raw text",
        rows=rows,
        summary=ScheduleSummary(
            total_rows=2,
            published_count=1,
            suspended_count=1,
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
        "total_rows": 2,
        "published_count": 1,
        "suspended_count": 1,
        "first_issue_number": 2635,
        "last_issue_number": 2635,
        "remarks": None,
    }
    assert upload.rows_json == [
        {"publish_date": "2026-01-05", "issue_number": 2635, "is_suspended": False},
        {"publish_date": "2026-02-16", "issue_number": None, "is_suspended": True},
    ]
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


class FailingRefreshDb(FakeWriteDb):
    def __init__(self):
        super().__init__()
        self.rolled_back = False
        self.refresh_error = RuntimeError("refresh failed")

    def refresh(self, obj):
        raise self.refresh_error


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


def test_create_preview_upload_keeps_file_and_does_not_rollback_on_refresh_failure(
    tmp_path, monkeypatch
):
    parsed = make_parsed_schedule()
    upload_root = tmp_path / "uploads" / "publication_schedules"
    monkeypatch.setattr(service, "UPLOAD_ROOT", upload_root)
    monkeypatch.setattr(service, "_safe_filename", lambda filename: "stored.pdf")
    monkeypatch.setattr(service, "parse_schedule_pdf", lambda content: parsed)
    db = FailingRefreshDb()

    with pytest.raises(RuntimeError) as exc:
        service.create_preview_upload(
            db,
            "schedule.pdf",
            "application/pdf",
            b"pdf-content",
            "alice",
        )

    assert exc.value is db.refresh_error
    assert db.committed is True
    assert db.rolled_back is False
    assert (upload_root / "2026" / "stored.pdf").read_bytes() == b"pdf-content"


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


class FakeCommitQuery:
    def __init__(self, db, model):
        self.db = db
        self.model = model

    def filter(self, *args):
        return self

    def first(self):
        if self.model is PublicationScheduleUpload:
            return self.db.upload
        raise AssertionError(f"unexpected first() for {self.model}")

    def delete(self, **kwargs):
        if self.model is not PublicationSchedule:
            raise AssertionError(f"unexpected delete() for {self.model}")
        self.db.deleted_schedule_years.append(self.db.upload.year)
        self.db.delete_kwargs.append(kwargs)
        return 1


class FakeCommitDb:
    def __init__(self, upload=None):
        self.upload = upload
        self.added = []
        self.committed = False
        self.commit_count = 0
        self.rollback_count = 0
        self.refreshed = None
        self.deleted_schedule_years = []
        self.delete_kwargs = []

    def query(self, model):
        return FakeCommitQuery(self, model)

    def add(self, obj):
        self.added.append(obj)

    def commit(self):
        self.committed = True
        self.commit_count += 1

    def refresh(self, obj):
        self.refreshed = obj

    def rollback(self):
        self.rollback_count += 1


def serialized_rows():
    return [
        {"publish_date": "2026-01-05", "issue_number": 2635, "is_suspended": False},
    ]


def make_upload(summary_json=None, rows_json=None):
    return PublicationScheduleUpload(
        id=10,
        year=2026,
        original_filename="schedule.pdf",
        stored_path="uploads/publication_schedules/2026/schedule.pdf",
        status=PublicationScheduleUploadStatus.previewed,
        summary_json=summary_json,
        error_json=[],
        uploaded_by="alice",
        raw_text="raw text",
        rows_json=serialized_rows() if rows_json is None else rows_json,
    )


def test_commit_schedule_upload_missing_upload_raises_value_error():
    with pytest.raises(ValueError) as exc:
        service.commit_schedule_upload(FakeCommitDb(upload=None), 10)

    assert str(exc.value) == "上传记录不存在"


def test_commit_schedule_upload_rejects_preview_errors_before_validation(monkeypatch):
    upload = make_upload()
    upload.error_json = ["preview error"]
    db = FakeCommitDb(upload=upload)
    monkeypatch.setattr(
        service,
        "validate_schedule_rows",
        lambda year, rows: pytest.fail("stored preview errors should block commit before validation"),
        raising=False,
    )

    with pytest.raises(ValueError) as exc:
        service.commit_schedule_upload(db, upload.id)

    assert str(exc.value) == "preview error"
    assert db.deleted_schedule_years == []
    assert db.added == []
    assert db.commit_count == 0


def test_commit_schedule_upload_does_not_accept_client_rows():
    upload = make_upload()
    db = FakeCommitDb(upload=upload)

    with pytest.raises(TypeError):
        service.commit_schedule_upload(
            db,
            upload.id,
            [ScheduleRowDraft(date(2026, 1, 5), 9999, False)],
        )


def test_commit_schedule_upload_validation_errors_mark_failed_and_commit(monkeypatch):
    upload = make_upload()
    db = FakeCommitDb(upload=upload)
    errors = ["出版日期年份必须为 2026：2027-01-05", "同一年内出版日期重复：2026-01-05"]
    monkeypatch.setattr(service, "validate_schedule_rows", lambda year, rows: errors, raising=False)

    with pytest.raises(ValueError) as exc:
        service.commit_schedule_upload(db, upload.id)

    assert str(exc.value) == "；".join(errors)
    assert upload.status == PublicationScheduleUploadStatus.failed
    assert upload.error_json == errors
    assert db.commit_count == 1


@pytest.mark.parametrize(
    ("rows_json", "expected_error"),
    [
        (None, "上传记录缺少预览行"),
        (
            [{"publish_date": "not-a-date", "issue_number": 2635, "is_suspended": False}],
            "上传记录预览行格式无效",
        ),
    ],
)
def test_commit_schedule_upload_malformed_preview_rows_mark_failed_without_replacement(
    monkeypatch, rows_json, expected_error
):
    upload = make_upload()
    upload.rows_json = rows_json
    db = FakeCommitDb(upload=upload)
    monkeypatch.setattr(
        service,
        "validate_schedule_rows",
        lambda year, rows: pytest.fail("invalid stored rows should fail before validation"),
        raising=False,
    )
    monkeypatch.setattr(
        service,
        "ensure_commit_is_safe",
        lambda db_arg, year, rows_arg: pytest.fail("invalid stored rows should fail before safety checks"),
    )

    with pytest.raises(ValueError) as exc:
        service.commit_schedule_upload(db, upload.id)

    assert str(exc.value) == expected_error
    assert upload.status == PublicationScheduleUploadStatus.failed
    assert upload.error_json == [expected_error]
    assert db.commit_count == 1
    assert db.deleted_schedule_years == []
    assert db.added == []


@pytest.mark.parametrize(
    "status",
    [
        PublicationScheduleUploadStatus.committed,
        PublicationScheduleUploadStatus.failed,
    ],
)
def test_commit_schedule_upload_rejects_non_previewed_upload_without_replacement(
    monkeypatch, status
):
    upload = make_upload()
    upload.status = status
    db = FakeCommitDb(upload=upload)
    monkeypatch.setattr(
        service,
        "validate_schedule_rows",
        lambda year, rows: pytest.fail("validation should not run"),
        raising=False,
    )

    with pytest.raises(ValueError) as exc:
        service.commit_schedule_upload(db, upload.id)

    assert str(exc.value) == "只有待确认的刊期表上传记录可以提交"
    assert db.deleted_schedule_years == []
    assert db.added == []
    assert db.commit_count == 0


def test_commit_schedule_upload_safety_error_marks_failed_commits_and_reraises(
    monkeypatch,
):
    upload = make_upload()
    db = FakeCommitDb(upload=upload)
    safety_error = ValueError("第 2635 期已创建，不能从刊期表中移除")
    monkeypatch.setattr(service, "validate_schedule_rows", lambda year, rows: [], raising=False)

    def fail_safety(db_arg, year, rows_arg):
        raise safety_error

    monkeypatch.setattr(service, "ensure_commit_is_safe", fail_safety)

    with pytest.raises(ValueError) as exc:
        service.commit_schedule_upload(db, upload.id)

    assert exc.value is safety_error
    assert upload.status == PublicationScheduleUploadStatus.failed
    assert upload.error_json == [str(safety_error)]
    assert db.commit_count == 1
    assert db.deleted_schedule_years == []
    assert db.added == []


def test_commit_schedule_upload_replaces_schedule_rows_and_invalidates_cache(monkeypatch):
    upload = make_upload(summary_json={"remarks": "春节休刊"})
    db = FakeCommitDb(upload=upload)
    safe_calls = []
    invalidated = []
    rows = [
        ScheduleRowDraft(date(2026, 1, 12), 2636, False),
        ScheduleRowDraft(date(2026, 1, 5), 2635, False),
        ScheduleRowDraft(date(2026, 1, 19), None, True),
    ]
    monkeypatch.setattr(service, "validate_schedule_rows", lambda year, rows: [], raising=False)
    monkeypatch.setattr(
        service,
        "ensure_commit_is_safe",
        lambda db_arg, year, rows_arg: safe_calls.append((db_arg, year, rows_arg)),
    )
    monkeypatch.setattr(
        service, "invalidate_dashboard_cache", lambda: invalidated.append(True), raising=False
    )

    upload.rows_json = [
        {
            "publish_date": row.publish_date.isoformat(),
            "issue_number": row.issue_number,
            "is_suspended": row.is_suspended,
        }
        for row in rows
    ]
    result = service.commit_schedule_upload(db, upload.id)

    assert result is upload
    assert safe_calls == [(db, 2026, rows)]
    assert db.deleted_schedule_years == [2026]
    assert db.delete_kwargs == [{"synchronize_session": False}]
    assert [schedule.publish_date for schedule in db.added] == [
        date(2026, 1, 5),
        date(2026, 1, 12),
        date(2026, 1, 19),
    ]
    assert [schedule.issue_number for schedule in db.added] == [2635, 2636, None]
    assert all(schedule.year == 2026 for schedule in db.added)
    assert upload.status == PublicationScheduleUploadStatus.committed
    assert upload.error_json == []
    assert upload.committed_at is not None
    assert upload.summary_json["remarks"] == "春节休刊"
    assert upload.summary_json["total_rows"] == 3
    assert upload.summary_json["suspended_count"] == 1
    assert db.commit_count == 1
    assert db.refreshed is upload
    assert invalidated == [True]


class FailingFinalCommitDb(FakeCommitDb):
    def __init__(self, upload=None):
        super().__init__(upload=upload)
        self.commit_error = RuntimeError("final commit failed")

    def commit(self):
        self.commit_count += 1
        raise self.commit_error


def test_commit_schedule_upload_final_commit_failure_rolls_back_and_reraises(
    monkeypatch,
):
    upload = make_upload()
    db = FailingFinalCommitDb(upload=upload)
    monkeypatch.setattr(service, "validate_schedule_rows", lambda year, rows: [], raising=False)
    monkeypatch.setattr(service, "ensure_commit_is_safe", lambda db, year, rows: None)

    with pytest.raises(RuntimeError) as exc:
        service.commit_schedule_upload(db, upload.id)

    assert exc.value is db.commit_error
    assert db.rollback_count == 1


class FailingCommitRefreshDb(FakeCommitDb):
    def __init__(self, upload=None):
        super().__init__(upload=upload)
        self.events = []
        self.refresh_error = RuntimeError("refresh failed")

    def commit(self):
        super().commit()
        self.events.append("commit")

    def refresh(self, obj):
        self.events.append("refresh")
        raise self.refresh_error


def test_commit_schedule_upload_invalidates_cache_after_commit_before_refresh_failure(
    monkeypatch,
):
    upload = make_upload()
    db = FailingCommitRefreshDb(upload=upload)
    monkeypatch.setattr(service, "validate_schedule_rows", lambda year, rows: [], raising=False)
    monkeypatch.setattr(service, "ensure_commit_is_safe", lambda db, year, rows: None)
    monkeypatch.setattr(
        service,
        "invalidate_dashboard_cache",
        lambda: db.events.append("invalidate"),
        raising=False,
    )

    with pytest.raises(RuntimeError) as exc:
        service.commit_schedule_upload(db, upload.id)

    assert exc.value is db.refresh_error
    assert db.events == ["commit", "invalidate", "refresh"]
    assert db.rollback_count == 0


def test_commit_schedule_upload_writes_suspended_rows_without_issue_number(monkeypatch):
    upload = make_upload()
    db = FakeCommitDb(upload=upload)
    monkeypatch.setattr(service, "validate_schedule_rows", lambda year, rows: [], raising=False)
    monkeypatch.setattr(service, "ensure_commit_is_safe", lambda db, year, rows: None)
    monkeypatch.setattr(service, "invalidate_dashboard_cache", lambda: None, raising=False)

    upload.rows_json = [{"publish_date": "2026-02-16", "issue_number": None, "is_suspended": True}]
    service.commit_schedule_upload(db, upload.id)

    assert len(db.added) == 1
    assert db.added[0].is_suspended is True
    assert db.added[0].issue_number is None
