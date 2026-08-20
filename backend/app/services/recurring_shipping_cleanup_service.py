"""Safely identify imported copies of the 2026 generated Shangyou rows."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.models import (
    PublicationSchedule,
    ShippingDetail,
    ShippingDetailSourceType,
    ShippingWaybillImportRow,
)
from app.services.recurring_shipping_detail_service import (
    SHANGYOU_GOVERNMENT_NAMES,
    SHANGYOU_GOVERNMENT_RECIPIENTS,
)


_REMOVABLE_SOURCE_TYPES = {
    ShippingDetailSourceType.manual,
    ShippingDetailSourceType.historical_import,
}


@dataclass(frozen=True)
class SkippedRecurringDuplicate:
    detail_id: int
    issue_number: int
    reason: str


@dataclass
class RecurringDuplicateCleanupPlan:
    year: int
    scanned_fixed_row_count: int = 0
    candidates: list[ShippingDetail] = field(default_factory=list)
    protected: list[SkippedRecurringDuplicate] = field(default_factory=list)
    skipped: list[SkippedRecurringDuplicate] = field(default_factory=list)

    @property
    def candidate_ids(self) -> list[int]:
        return [int(row.id) for row in self.candidates]

    @property
    def candidate_issue_numbers(self) -> list[int]:
        return sorted({int(row.issue_number) for row in self.candidates})

    @property
    def candidate_quantity(self) -> int:
        return sum(row.quantity or 0 for row in self.candidates)


def shipping_detail_has_fulfillment_history(detail: ShippingDetail) -> bool:
    """Return whether deleting a detail could destroy fulfillment evidence."""
    return bool(
        detail.shipped_at
        or detail.actual_name
        or detail.actual_address
        or detail.actual_phone
        or detail.actual_adjustment_reason
        or detail.actual_adjusted_at
        or detail.shipped_quantity is not None
        or detail.tracking_no
        or detail.order_id
        or detail.order_item_id
        or detail.fulfillment_target_id
        or detail.complaint_makeup_item_id
        or detail.packages
        or detail.fulfillment_adjustments
        or detail.deferrals
        or detail.package_allocations
    )


def build_recurring_duplicate_cleanup_plan(
    db: Session,
    *,
    year: int = 2026,
    for_update: bool = False,
    only_issue_numbers: Iterable[int] | None = None,
) -> RecurringDuplicateCleanupPlan:
    """Select only identity-matching imported rows beside one generated peer."""
    issue_numbers = [
        int(value)
        for (value,) in db.query(PublicationSchedule.issue_number).filter(
            PublicationSchedule.year == year,
            PublicationSchedule.is_suspended.is_(False),
            PublicationSchedule.issue_number.isnot(None),
        )
    ]
    requested_issues = (
        {int(issue_number) for issue_number in only_issue_numbers}
        if only_issue_numbers is not None
        else None
    )
    if requested_issues is not None:
        issue_numbers = [
            issue_number for issue_number in issue_numbers
            if issue_number in requested_issues
        ]
    plan = RecurringDuplicateCleanupPlan(year=year)
    if year != 2026 or not issue_numbers:
        return plan

    query = db.query(ShippingDetail).filter(
        ShippingDetail.issue_number.in_(issue_numbers),
        ShippingDetail.name.in_(SHANGYOU_GOVERNMENT_NAMES),
    )
    if for_update:
        query = query.with_for_update()
    rows = query.order_by(ShippingDetail.issue_number, ShippingDetail.name, ShippingDetail.id).all()
    plan.scanned_fixed_row_count = len(rows)

    directly_linked_ids = {
        int(detail_id)
        for (detail_id,) in db.query(ShippingWaybillImportRow.shipping_detail_id).filter(
            ShippingWaybillImportRow.shipping_detail_id.in_([row.id for row in rows])
        )
        if detail_id is not None
    }
    by_key: dict[tuple[int, str], list[ShippingDetail]] = {}
    for row in rows:
        by_key.setdefault((int(row.issue_number), row.name.strip()), []).append(row)
    canonical = {
        str(recipient["name"]): recipient
        for recipient in SHANGYOU_GOVERNMENT_RECIPIENTS
    }

    for (issue_number, name), matches in by_key.items():
        generated = [
            row
            for row in matches
            if row.source_type == ShippingDetailSourceType.recurring_generated
        ]
        imported = [row for row in matches if row.source_type in _REMOVABLE_SOURCE_TYPES]
        if not imported:
            continue
        if len(generated) != 1:
            for row in imported:
                plan.skipped.append(SkippedRecurringDuplicate(
                    detail_id=int(row.id),
                    issue_number=issue_number,
                    reason="固定生成基准行不是恰好1条",
                ))
            continue

        expected = canonical[name]
        for row in imported:
            if any(
                getattr(row, field_name) != expected[field_name]
                for field_name in ("name", "address", "phone", "quantity")
            ):
                plan.skipped.append(SkippedRecurringDuplicate(
                    detail_id=int(row.id),
                    issue_number=issue_number,
                    reason="姓名、地址、电话或份数与固定生成基准不完全一致",
                ))
                continue
            if row.id in directly_linked_ids or shipping_detail_has_fulfillment_history(row):
                plan.protected.append(SkippedRecurringDuplicate(
                    detail_id=int(row.id),
                    issue_number=issue_number,
                    reason="已关联运单、实发、核销、延期、分配或订单履约记录",
                ))
                continue
            plan.candidates.append(row)
    return plan


def delete_recurring_duplicate_candidates(
    db: Session,
    plan: RecurringDuplicateCleanupPlan,
) -> int:
    """Delete exactly the already-audited candidate objects in this transaction."""
    for row in plan.candidates:
        db.delete(row)
    db.flush()
    return len(plan.candidates)
