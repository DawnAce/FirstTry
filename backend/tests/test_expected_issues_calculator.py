"""Tests for expected_issues_calculator.

Uses a FakeDb stand-in (project convention) that distinguishes between
the COUNT(*) and MAX(publish_date) queries the service performs.
"""

from datetime import date

from app.models import FulfillmentType
from app.services import expected_issues_calculator as calc


class _FakeQuery:
    def __init__(self, value):
        self._value = value

    def filter(self, *args, **kwargs):
        return self

    def scalar(self):
        return self._value


class FakeDb:
    """Returns a configured value depending on which aggregate is queried.

    The service only does two kinds of queries:
      - ``db.query(func.count(PublicationSchedule.id)).filter(...).scalar()``
      - ``db.query(func.max(PublicationSchedule.publish_date)).filter(...).scalar()``
    so we distinguish them by inspecting the textual representation
    (the SQLAlchemy expressions for count/max contain those literal
    function names, which is stable enough for unit tests).
    """

    def __init__(self, known_count: int = 0, latest_known: date | None = None):
        self.known_count = known_count
        self.latest_known = latest_known

    def query(self, expr):
        text = str(expr).lower()
        if "count" in text:
            return _FakeQuery(self.known_count)
        if "max" in text:
            return _FakeQuery(self.latest_known)
        raise AssertionError(f"unexpected query: {expr}")


# ---------------------------------------------------------------------------
# Non-subscription branches: no DB access needed.
# ---------------------------------------------------------------------------


def test_single_issue_returns_one():
    db = FakeDb()
    n = calc.compute_expected_issues(
        db,
        coverage_start=None,
        coverage_end=None,
        fulfillment_type=FulfillmentType.single_issue,
    )
    assert n == 1


def test_gift_returns_none():
    db = FakeDb()
    assert (
        calc.compute_expected_issues(
            db, None, None, FulfillmentType.gift
        )
        is None
    )


def test_makeup_returns_none():
    db = FakeDb()
    assert (
        calc.compute_expected_issues(
            db, None, None, FulfillmentType.makeup
        )
        is None
    )


def test_extension_v2_hook_returns_none():
    db = FakeDb()
    assert (
        calc.compute_expected_issues(
            db, None, None, FulfillmentType.extension
        )
        is None
    )


def test_replacement_v2_hook_returns_none():
    db = FakeDb()
    assert (
        calc.compute_expected_issues(
            db, None, None, FulfillmentType.replacement
        )
        is None
    )


# ---------------------------------------------------------------------------
# Subscription branch with various coverage shapes.
# ---------------------------------------------------------------------------


def test_subscription_with_no_coverage_returns_none():
    db = FakeDb()
    assert (
        calc.compute_expected_issues(
            db, None, None, FulfillmentType.subscription
        )
        is None
    )


def test_subscription_with_partial_coverage_returns_none():
    db = FakeDb()
    # missing one date -> can't compute
    assert (
        calc.compute_expected_issues(
            db, date(2026, 1, 1), None, FulfillmentType.subscription
        )
        is None
    )


def test_subscription_fully_inside_schedule_returns_known_count():
    # latest known publish_date == coverage_end -> nothing to estimate
    db = FakeDb(known_count=43, latest_known=date(2026, 12, 28))
    n = calc.compute_expected_issues(
        db,
        coverage_start=date(2026, 3, 2),
        coverage_end=date(2026, 12, 28),
        fulfillment_type=FulfillmentType.subscription,
    )
    assert n == 43


def test_subscription_latest_after_coverage_end_returns_known_count():
    # If latest publish_date >= coverage_end the entire range is known.
    db = FakeDb(known_count=10, latest_known=date(2026, 12, 28))
    n = calc.compute_expected_issues(
        db,
        coverage_start=date(2026, 10, 1),
        coverage_end=date(2026, 12, 1),
        fulfillment_type=FulfillmentType.subscription,
    )
    assert n == 10


def test_subscription_crosses_into_unknown_future_estimates_remainder():
    # 2026 known: 43 issues with latest 2026-12-28.
    # Coverage ends 2027-02-28 — 62 unknown days -> floor(62/7) = 8 weeks.
    db = FakeDb(known_count=43, latest_known=date(2026, 12, 28))
    n = calc.compute_expected_issues(
        db,
        coverage_start=date(2026, 3, 2),
        coverage_end=date(2027, 2, 28),
        fulfillment_type=FulfillmentType.subscription,
    )
    assert n == 43 + 8  # = 51


def test_subscription_with_empty_schedule_estimates_full_range():
    # No publication_schedule rows at all yet for that year.
    # Coverage = 2027-01-01 ~ 2027-12-31 — 364 days, 364//7 = 52 weeks.
    db = FakeDb(known_count=0, latest_known=None)
    n = calc.compute_expected_issues(
        db,
        coverage_start=date(2027, 1, 1),
        coverage_end=date(2027, 12, 31),
        fulfillment_type=FulfillmentType.subscription,
    )
    assert n == 52


def test_subscription_reversed_dates_returns_zero():
    # Edge case: caller passes end before start. Should not crash; we
    # return 0 so the order can still be saved as a draft and validated
    # later in the API layer.
    db = FakeDb(known_count=0, latest_known=None)
    n = calc.compute_expected_issues(
        db,
        coverage_start=date(2026, 12, 1),
        coverage_end=date(2026, 1, 1),
        fulfillment_type=FulfillmentType.subscription,
    )
    assert n == 0


def test_subscription_same_day_coverage_returns_known_zero_or_one():
    # Coverage of a single day with no known publication.
    db = FakeDb(known_count=0, latest_known=None)
    n = calc.compute_expected_issues(
        db,
        coverage_start=date(2026, 6, 1),
        coverage_end=date(2026, 6, 1),
        fulfillment_type=FulfillmentType.subscription,
    )
    # 0 days remaining // 7 == 0; no known issues
    assert n == 0
