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
* ``subscription`` →
  1. Count rows in ``publication_schedule`` whose ``publish_date``
     falls in ``[coverage_start, coverage_end]`` AND whose
     ``issue_number IS NOT NULL`` (i.e. exclude 休刊 weeks).
  2. If the latest known ``publish_date`` (≤ coverage_end) is still
     before ``coverage_end``, the coverage period extends beyond the
     uploaded schedule. Add a rough estimate of ``days_remaining // 7``
     for the unknown future. Holiday/休刊 corrections happen when the
     real schedule lands (V1.3 drift alert).

The whole result is just a hint — the authoritative count for
fulfillment is the actual ``shipping_details`` rows synced from the
allocation at sync time. See decision ``v1-drift-method-b``.
"""

from datetime import date
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import PublicationSchedule
from app.models.order_item import FulfillmentType


def compute_expected_issues(
    db: Session,
    coverage_start: Optional[date],
    coverage_end: Optional[date],
    fulfillment_type: FulfillmentType,
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
