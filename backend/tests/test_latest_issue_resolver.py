"""Unit tests for latest_issue_resolver — which weekly issue a 「最新一期」 order ships.

中国经营报 publishes Mondays; the on-sale latest issue flips Fri ~22:00 (±4h fuzzy).
"""

from datetime import date, datetime
from types import SimpleNamespace

from app.services.latest_issue_resolver import _on_sale_start, resolve_latest_issue


def _sched():
    # Mondays in 2026: 06-15 (2625), 06-22 (2626), 06-29 (2627)
    return [
        SimpleNamespace(issue_number=2625, publish_date=date(2026, 6, 15), is_suspended=False),
        SimpleNamespace(issue_number=2626, publish_date=date(2026, 6, 22), is_suspended=False),
        SimpleNamespace(issue_number=2627, publish_date=date(2026, 6, 29), is_suspended=False),
    ]


def test_on_sale_start_is_friday_2200_before_monday():
    # 6-22 (Mon) goes on sale Fri 6-19 22:00
    assert _on_sale_start(date(2026, 6, 22)) == datetime(2026, 6, 19, 22, 0)


def test_before_friday_flip_gets_current_published_issue():
    r = resolve_latest_issue(_sched(), datetime(2026, 6, 19, 21, 0))  # Fri 21:00
    assert r.issue_number == 2625        # already-published latest
    assert r.note is not None            # 1h before flip → borderline


def test_after_friday_flip_gets_upcoming_issue():
    r = resolve_latest_issue(_sched(), datetime(2026, 6, 19, 23, 0))  # Fri 23:00
    assert r.issue_number == 2626        # upcoming issue
    assert r.note is not None            # 1h after flip → borderline


def test_midweek_is_clean():
    r = resolve_latest_issue(_sched(), datetime(2026, 6, 17, 10, 0))  # Wed
    assert r.issue_number == 2625
    assert r.note is None


def test_borderline_window_is_exactly_4h():
    # 18:00 = exactly 4h before the 22:00 flip → flagged; 17:59 → clean
    assert resolve_latest_issue(_sched(), datetime(2026, 6, 19, 18, 0)).note is not None
    assert resolve_latest_issue(_sched(), datetime(2026, 6, 19, 17, 59)).note is None


def test_suspended_weeks_skipped():
    sched = _sched() + [
        SimpleNamespace(issue_number=None, publish_date=date(2026, 7, 6), is_suspended=True),
    ]
    r = resolve_latest_issue(sched, datetime(2026, 6, 24, 10, 0))  # Wed, in 6-22 window
    assert r.issue_number == 2626
    assert r.note is None


def test_missing_payment_time_unresolvable():
    r = resolve_latest_issue(_sched(), None)
    assert r.issue_number is None and r.note


def test_before_earliest_unresolvable():
    # before the first flip (6-12 22:00) → can't pin an issue
    r = resolve_latest_issue(_sched(), datetime(2026, 6, 1, 0, 0))
    assert r.issue_number is None and r.note
