"""Expected issues calculator.

For an order item the system needs to estimate "how many issues will
this customer actually receive" so the operator can spot drift after
the publication schedule changes (V1.3 feature). The estimate is
stored on ``order_items.expected_issues_at_creation`` when the order
is confirmed.

Strategy (V1.1):

* ``single_issue`` → always 1.
* ``gift`` / ``makeup`` / ``extension`` / ``replacement`` → ``None``
  (these are not auto-synced from the schedule).
* ``subscription`` → depends on the publication's cadence:
  - ``business_school`` (月刊) → count overlapping rows in the
    商学院 issue calendar (``bs_issues``). A weekly estimate would
    over-count a monthly by ~4.7× and corrupt drift detection.
  - everything else (中国经营报 周报, the default) →
    1. Count rows in ``publication_schedule`` whose ``publish_date``
       falls in ``[coverage_start, coverage_end]`` AND whose
       ``issue_number IS NOT NULL`` (i.e. exclude 休刊 weeks).
    2. If the latest known ``publish_date`` (≤ coverage_end) is still
       before ``coverage_end``, the coverage period extends beyond the
       uploaded schedule. Add a rough estimate of ``days_remaining // 7``
       for the unknown future. Holiday/休刊 corrections happen when the
       real schedule lands (V1.3 drift alert).

``publication`` defaults to ``None`` → the weekly path, so callers that
don't (yet) know the publication keep the legacy behaviour.

The whole result is just a hint — the authoritative count for
fulfillment is the actual ``shipping_details`` rows synced from the
allocation at sync time. See decision ``v1-drift-method-b``.
"""

import calendar as _calendar
from datetime import date
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import PublicationSchedule
from app.models.bs_issue import BsIssue
from app.models.order_item import FulfillmentType, Publication


def compute_expected_issues(
    db: Session,
    coverage_start: Optional[date],
    coverage_end: Optional[date],
    fulfillment_type: FulfillmentType,
    publication: Optional[Publication] = None,
) -> Optional[int]:
    """Return the expected number of issues for the given coverage."""
    if fulfillment_type == FulfillmentType.single_issue:
        return 1
    if fulfillment_type != FulfillmentType.subscription:
        return None
    if coverage_start is None or coverage_end is None:
        return None
    if coverage_end < coverage_start:
        return 0

    if publication == Publication.business_school:
        return _count_business_school_issues(db, coverage_start, coverage_end)

    known = (
        db.query(func.count(PublicationSchedule.id))
        .filter(
            PublicationSchedule.publish_date >= coverage_start,
            PublicationSchedule.publish_date <= coverage_end,
            PublicationSchedule.issue_number.isnot(None),
        )
        .scalar()
    ) or 0

    latest = (
        db.query(func.max(PublicationSchedule.publish_date))
        .filter(PublicationSchedule.publish_date <= coverage_end)
        .scalar()
    )

    if latest is None:
        # No schedule loaded yet — estimate the whole range at ~1 / 7d.
        days_remaining = (coverage_end - coverage_start).days
        estimated = max(0, days_remaining // 7)
        return known + estimated

    if latest < coverage_end:
        days_remaining = (coverage_end - latest).days
        estimated = max(0, days_remaining // 7)
        return known + estimated

    return known


def _bs_issue_overlaps(issue: BsIssue, cov_start: date, cov_end: date) -> bool:
    """该商学院刊历期 [起月1号, 止月月末] 是否与覆盖期 [cov_start, cov_end] 有交集。

    合刊（2~3月）整体算一期，覆盖期落到任一月即命中。与
    ``order_analytics_service._issue_covers`` 同口径（此处独立一份，避免低层
    calculator 反向依赖 analytics 服务）。
    """
    first = date(issue.year, issue.month_start, 1)
    last_day = _calendar.monthrange(issue.year, issue.month_end)[1]
    last = date(issue.year, issue.month_end, last_day)
    return first <= cov_end and last >= cov_start


def _count_business_school_issues(
    db: Session,
    coverage_start: date,
    coverage_end: date,
) -> int:
    """商学院月刊订阅的期数 = 覆盖期命中的刊历期数（含合刊去重）。

    刊历缺该覆盖跨度的全部年份时（如未来年），退回 ~1 期/月 的粗估，免得
    返 0；某年有刊历但覆盖期不真正落在任何一期上时，正确返回 0。
    """
    years = list(range(coverage_start.year, coverage_end.year + 1))
    issues = db.query(BsIssue).filter(BsIssue.year.in_(years)).all()
    count = sum(
        1 for b in issues if _bs_issue_overlaps(b, coverage_start, coverage_end)
    )
    if count == 0 and not issues:
        months = (
            (coverage_end.year - coverage_start.year) * 12
            + (coverage_end.month - coverage_start.month)
            + 1
        )
        return max(0, months)
    return count
