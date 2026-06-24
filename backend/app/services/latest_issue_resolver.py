"""Resolve which physical issue a 「最新一期」(latest-issue) single-issue order ships.

中国经营报 publishes weekly on **Mondays**. The on-sale "最新一期" flips to the
upcoming Monday issue every **Friday ~22:00** (approximate). So:

* an issue goes on sale at the Friday-22:00 **before** its Monday publish date;
* an order's issue = the issue whose on-sale window contains the order's payment
  time (= the latest issue whose on-sale start ≤ payment time);
* orders within **±4h** of a Friday-22:00 flip are flagged for review, because the
  exact flip time is only approximate.

Example: 6-22 issue goes on sale Fri 6-19 22:00. Order before that → 6-15 issue
(already published, the latest one); order after → 6-22 issue (即将出刊).

Configurable in one place: FLIP_WEEKDAY / FLIP_HOUR / BORDERLINE_HOURS below.
"""

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Optional


FLIP_WEEKDAY = 4          # Friday (Mon=0 … Sun=6)
FLIP_HOUR = 22            # ~22:00, approximate
BORDERLINE_HOURS = 4      # orders within ±this many hours of a flip → flagged


@dataclass
class LatestIssueResolution:
    issue_number: Optional[int]
    publish_date: Optional[date]
    note: Optional[str]   # warning when borderline / unresolvable; None when clean


def _on_sale_start(publish_date: date, flip_hour: int = FLIP_HOUR) -> datetime:
    """The Friday-before-publish at ``flip_hour`` when this issue starts selling."""
    days_back = (publish_date.weekday() - FLIP_WEEKDAY) % 7  # Monday → 3 (prev Friday)
    return datetime.combine(publish_date - timedelta(days=days_back), time(flip_hour, 0))


def resolve_latest_issue(
    schedule,
    payment_time: Optional[datetime],
    *,
    flip_hour: int = FLIP_HOUR,
    borderline_hours: int = BORDERLINE_HOURS,
) -> LatestIssueResolution:
    """Pick the issue a 「最新一期」 order bought, from the weekly schedule + payment time.

    ``schedule`` is any iterable of objects exposing ``issue_number`` /
    ``publish_date`` / ``is_suspended`` (e.g. ``PublicationSchedule`` rows).
    Returns the assigned issue plus a non-None ``note`` when borderline or
    unresolvable (the caller surfaces it as an import warning; the order still
    imports with the auto-assigned issue).
    """
    if payment_time is None:
        return LatestIssueResolution(None, None, "缺少付款时间，无法判定最新一期")

    entries = sorted(
        (
            (_on_sale_start(s.publish_date, flip_hour), s.issue_number, s.publish_date)
            for s in schedule
            if not getattr(s, "is_suspended", False)
            and s.issue_number is not None
            and s.publish_date is not None
        ),
        key=lambda e: e[0],
    )
    if not entries:
        return LatestIssueResolution(None, None, "刊期表为空，无法判定最新一期")

    idx = None
    for i, (on_sale, _num, _pub) in enumerate(entries):
        if on_sale <= payment_time:
            idx = i
        else:
            break
    if idx is None:
        return LatestIssueResolution(
            None, None, "付款时间早于刊期表最早一期，无法判定，请核对/补刊期表"
        )

    on_sale, num, pub = entries[idx]
    margin = timedelta(hours=borderline_hours)
    borderline = (payment_time - on_sale) <= margin
    if not borderline and idx + 1 < len(entries):
        if (entries[idx + 1][0] - payment_time) <= margin:
            borderline = True

    if borderline:
        note = f"翻期临界（周五约 {flip_hour} 点 ±{borderline_hours}h）：自动判为第 {num} 期，请核对"
    elif idx == len(entries) - 1 and (payment_time - on_sale) > timedelta(days=7):
        note = f"付款时间超出刊期表范围：暂判为第 {num} 期，请补刊期表/核对"
    else:
        note = None
    return LatestIssueResolution(num, pub, note)
