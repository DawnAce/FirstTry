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
