"""Maintain shipping details that recur unchanged on every active issue."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable

from sqlalchemy.orm import Session

from app.models import PublicationSchedule, ShippingDetail, ShippingDetailSourceType
from app.schemas.history_import import ShippingImportRow
from app.services.operation_log_service import record_operation


SHANGYOU_GOVERNMENT_RECIPIENTS = (
    {
        "name": "上犹县政府办",
        "address": "江西省赣州市上犹县东山镇犹江大道16号县政府大楼325室政府办",
        "phone": "0797-8542306",
        "quantity": 10,
    },
    {
        "name": "上犹县人大办",
        "address": "江西省赣州市上犹县东山镇犹江大道16号县政府大楼211室人大办",
        "phone": "0797-8541223",
        "quantity": 11,
    },
    {
        "name": "上犹县政协办",
        "address": "江西省赣州市上犹县东山镇犹江大道16号县政府大楼232室政协办",
        "phone": "0797-8541235",
        "quantity": 9,
    },
)

SHANGYOU_GOVERNMENT_NAMES = frozenset(
    row["name"] for row in SHANGYOU_GOVERNMENT_RECIPIENTS
)

_COMMON_FIELDS = {
    "sheet_name": "上犹",
    "channel": "赠阅",
    "sub_channel": "政府",
    "transport": "邮政物流",
    "frequency": "周",
    "status": "正常",
    "deadline": "",
    "notes": "政府赠报，邮政",
    "extra_info": "",
    "station_name": "",
    "station_hall": "",
    "contact_person": "",
    "seq_number": None,
    "period_count": None,
    "confirmation": None,
    "company": "上犹县政府",
    "source_type": ShippingDetailSourceType.recurring_generated,
}


@dataclass
class RecurringShippingBackfillResult:
    year: int
    active_issue_count: int = 0
    created_count: int = 0
    updated_count: int = 0
    unchanged_count: int = 0
    changed_issue_numbers: list[int] = field(default_factory=list)


def recurring_shipping_details_for_issue(
    db: Session,
    *,
    issue_number: int,
    year: int | None,
    for_update: bool = False,
) -> list[ShippingDetail]:
    """Return the fixed rows that must be preserved beside imported rows."""
    if year != 2026:
        return []
    query = db.query(ShippingDetail).filter(
        ShippingDetail.issue_number == issue_number,
        ShippingDetail.name.in_(SHANGYOU_GOVERNMENT_NAMES),
        ShippingDetail.source_type == ShippingDetailSourceType.recurring_generated,
    )
    if for_update:
        query = query.with_for_update()
    return query.order_by(ShippingDetail.id).all()


def recurring_shipping_detail_signature(
    details: Iterable[ShippingDetail],
) -> list[dict[str, int | str | None]]:
    """Build a stable preview/commit signature without exposing recipient PII."""
    return [
        {
            "id": detail.id,
            "name": detail.name,
            "quantity": detail.quantity or 0,
            "updated_at": detail.updated_at.isoformat() if detail.updated_at else None,
        }
        for detail in details
    ]


def recurring_shipping_invariant_errors(
    db: Session,
    *,
    issue_number: int,
    year: int | None,
    for_update: bool = False,
) -> list[str]:
    """Reject duplicate or non-generated ownership of 2026 fixed recipients.

    Missing rows are permitted because the one-off generator may not have been
    run for a newly added schedule yet. Once a fixed recipient exists, however,
    exactly one canonical ``recurring_generated`` row must own that recipient.
    """
    if year != 2026:
        return []
    query = db.query(ShippingDetail).filter(
        ShippingDetail.issue_number == issue_number,
        ShippingDetail.name.in_(SHANGYOU_GOVERNMENT_NAMES),
    )
    if for_update:
        query = query.with_for_update()
    rows = query.order_by(ShippingDetail.id).all()
    by_name: dict[str, list[ShippingDetail]] = {}
    for row in rows:
        by_name.setdefault(row.name.strip(), []).append(row)

    expected_by_name = {
        str(recipient["name"]): int(recipient["quantity"])
        for recipient in SHANGYOU_GOVERNMENT_RECIPIENTS
    }
    errors: list[str] = []
    for name, matches in by_name.items():
        if len(matches) != 1:
            errors.append(f"{issue_number} 期固定收件人「{name}」存在 {len(matches)} 条明细")
            continue
        row = matches[0]
        if row.source_type != ShippingDetailSourceType.recurring_generated:
            errors.append(f"{issue_number} 期固定收件人「{name}」不是系统固定生成明细")
        expected_quantity = expected_by_name[name]
        if (row.quantity or 0) != expected_quantity:
            errors.append(
                f"{issue_number} 期固定收件人「{name}」应为 {expected_quantity} 份，"
                f"当前为 {row.quantity or 0} 份"
            )
    return errors


def exclude_recurring_shipping_import_rows(
    rows: Iterable[ShippingImportRow],
    *,
    year: int | None,
) -> tuple[list[ShippingImportRow], list[str]]:
    """Drop uploaded copies of rows already owned by the recurring generator."""
    materialized = list(rows)
    if year != 2026:
        return materialized, []

    kept: list[ShippingImportRow] = []
    ignored: list[ShippingImportRow] = []
    for row in materialized:
        if row.name.strip() in SHANGYOU_GOVERNMENT_NAMES:
            ignored.append(row)
        else:
            kept.append(row)
    if not ignored:
        return kept, []
    names = "、".join(dict.fromkeys(row.name.strip() for row in ignored))
    ignored_quantity = sum(row.quantity or 0 for row in ignored)
    if {row.name.strip() for row in ignored} == SHANGYOU_GOVERNMENT_NAMES and ignored_quantity == 30:
        return kept, [
            "现有系统里已有2026年「上犹」的3个政府单位，导入数据会忽略该30份明细。"
        ]
    return kept, [
        f"现有系统里已有2026年「上犹」政府单位固定明细；本次导入会忽略"
        f" {len(ignored)} 条、{ignored_quantity} 份（{names}）。"
    ]


def _canonical_values(recipient: dict) -> dict:
    return {**_COMMON_FIELDS, **recipient}


def ensure_recurring_shipping_details(
    db: Session,
    *,
    year: int,
    username: str = "system",
) -> RecurringShippingBackfillResult:
    """Correct existing rows and fill missing recurring rows for active issues."""
    schedules = (
        db.query(PublicationSchedule)
        .filter(
            PublicationSchedule.year == year,
            PublicationSchedule.is_suspended.is_(False),
            PublicationSchedule.issue_number.isnot(None),
        )
        .order_by(PublicationSchedule.publish_date)
        .all()
    )
    result = RecurringShippingBackfillResult(year=year, active_issue_count=len(schedules))
    changed_issues: set[int] = set()

    for schedule in schedules:
        issue_number = int(schedule.issue_number)
        existing_rows = (
            db.query(ShippingDetail)
            .filter(
                ShippingDetail.issue_number == issue_number,
                ShippingDetail.name.in_(SHANGYOU_GOVERNMENT_NAMES),
            )
            .order_by(ShippingDetail.id)
            .all()
        )
        by_name: dict[str, ShippingDetail] = {}
        for detail in existing_rows:
            if detail.name in by_name:
                raise ValueError(f"{issue_number} 期存在重复固定收件人：{detail.name}")
            by_name[detail.name] = detail

        for recipient in SHANGYOU_GOVERNMENT_RECIPIENTS:
            values = _canonical_values(recipient)
            detail = by_name.get(recipient["name"])
            if detail is None:
                db.add(ShippingDetail(issue_number=issue_number, **values))
                result.created_count += 1
                changed_issues.add(issue_number)
                continue

            changed = False
            for field_name, value in values.items():
                if getattr(detail, field_name) != value:
                    setattr(detail, field_name, value)
                    changed = True
            if changed:
                result.updated_count += 1
                changed_issues.add(issue_number)
            else:
                result.unchanged_count += 1

    result.changed_issue_numbers = sorted(changed_issues)
    if result.created_count or result.updated_count:
        record_operation(
            db,
            table_name="shipping_details",
            record_id=0,
            record_name=f"{year}年上犹政府固定发货明细",
            action="generate_fixed",
            username=username,
            channel="赠阅",
            changes={
                "year": year,
                "active_issue_count": result.active_issue_count,
                "created_count": result.created_count,
                "updated_count": result.updated_count,
                "unchanged_count": result.unchanged_count,
                "changed_issue_numbers": result.changed_issue_numbers,
                "recipient_names": sorted(SHANGYOU_GOVERNMENT_NAMES),
            },
        )
    return result
