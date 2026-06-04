from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import PublicationSchedule
from app.models.order_item import DeliveryMethod, SubscriptionTerm


PACKAGE_PRICES: dict[tuple[SubscriptionTerm, DeliveryMethod], Decimal] = {
    (SubscriptionTerm.half_year, DeliveryMethod.post_office): Decimal("120"),
    (SubscriptionTerm.half_year, DeliveryMethod.zto_mf): Decimal("195"),
    (SubscriptionTerm.one_year, DeliveryMethod.post_office): Decimal("240"),
    (SubscriptionTerm.one_year, DeliveryMethod.zto_mf): Decimal("390"),
}


@dataclass(frozen=True)
class PricingPreview:
    month_range_label: str
    coverage_start_date: date
    coverage_end_date: date
    expected_issue_count: int
    unit_price: Decimal
    subtotal: Decimal
    price_label: str
    schedule_incomplete: bool
    warning: str | None = None


def build_pricing_preview(
    db: Session,
    *,
    subscription_term: SubscriptionTerm,
    delivery_method: DeliveryMethod,
    term_start_month: str,
    total_quantity: int,
) -> PricingPreview:
    if subscription_term == SubscriptionTerm.custom:
        raise ValueError("自定义期限不支持自动套餐价预览")
    if total_quantity < 1:
        raise ValueError("每期总份数至少为 1")

    start_year, start_month = _parse_month(term_start_month)
    months = 6 if subscription_term == SubscriptionTerm.half_year else 12
    end_year, end_month = _add_months(start_year, start_month, months - 1)
    range_start = date(start_year, start_month, 1)
    range_end = date(end_year, end_month, calendar.monthrange(end_year, end_month)[1])

    first_issue = (
        db.query(func.min(PublicationSchedule.publish_date))
        .filter(
            PublicationSchedule.publish_date >= range_start,
            PublicationSchedule.publish_date <= range_end,
            PublicationSchedule.issue_number.isnot(None),
        )
        .scalar()
    )
    last_issue = (
        db.query(func.max(PublicationSchedule.publish_date))
        .filter(
            PublicationSchedule.publish_date >= range_start,
            PublicationSchedule.publish_date <= range_end,
            PublicationSchedule.issue_number.isnot(None),
        )
        .scalar()
    )
    issue_count = (
        db.query(func.count(PublicationSchedule.id))
        .filter(
            PublicationSchedule.publish_date >= range_start,
            PublicationSchedule.publish_date <= range_end,
            PublicationSchedule.issue_number.isnot(None),
        )
        .scalar()
        or 0
    )
    if first_issue is None or last_issue is None or issue_count == 0:
        raise ValueError("该月份范围内没有可履约出版期，请检查期刊表或改用自定义")

    latest_schedule_date = db.query(func.max(PublicationSchedule.publish_date)).scalar()
    schedule_incomplete = bool(
        latest_schedule_date is None
        or (latest_schedule_date.year, latest_schedule_date.month) < (end_year, end_month)
    )
    unit_price = PACKAGE_PRICES[(subscription_term, delivery_method)]
    subtotal = unit_price * Decimal(total_quantity)
    term_label = "半年" if subscription_term == SubscriptionTerm.half_year else "一年"
    delivery_label = "ZTO-MF 快递" if delivery_method == DeliveryMethod.zto_mf else "邮局投递"

    return PricingPreview(
        month_range_label=f"{start_year}年{start_month}月～{end_year}年{end_month}月",
        coverage_start_date=first_issue,
        coverage_end_date=last_issue,
        expected_issue_count=int(issue_count),
        unit_price=unit_price,
        subtotal=subtotal,
        price_label=f"{delivery_label}{term_label}套餐",
        schedule_incomplete=schedule_incomplete,
        warning="期刊表尚未覆盖完整月份范围，请补齐后复核覆盖期" if schedule_incomplete else None,
    )


def _parse_month(value: str) -> tuple[int, int]:
    try:
        year_text, month_text = value.split("-", 1)
        year = int(year_text)
        month = int(month_text)
    except ValueError as exc:
        raise ValueError("起始月份格式必须为 YYYY-MM") from exc
    if month < 1 or month > 12:
        raise ValueError("起始月份格式必须为 YYYY-MM")
    return year, month


def _add_months(year: int, month: int, delta: int) -> tuple[int, int]:
    zero_based = (month - 1) + delta
    return year + zero_based // 12, zero_based % 12 + 1
