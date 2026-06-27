"""Pydantic schemas for sales analytics (per-campaign, per-issue, …).

These rows are assembled by the service layer via GROUP BY aggregation, so
they are plain ``BaseModel``s (not ``from_attributes`` ORM projections).
"""

from datetime import date
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel


class CampaignSummaryRow(BaseModel):
    """One marketing campaign's sales roll-up.

    ``total_paid`` is the **net** cash received = ``SUM(paid_amount - refunded_amount)``
    (退款已冲减；全额退款 / 取消单已被整单排除). ``total_refunded`` exposes the
    refunded total for transparency. ``total_listed`` is the pre-discount 原价 total
    (``COALESCE(original_amount, paid_amount)`` summed — orders with no captured list
    price count as no-discount). ``total_discount = total_listed - 毛实付`` is the
    pure pricing discount (折扣按折前-实付算，不含退款).
    """

    campaign: str
    order_count: int
    total_paid: Decimal
    total_refunded: Decimal
    total_listed: Decimal
    total_discount: Decimal


class CampaignSummaryOut(BaseModel):
    """Per-campaign sales summary + grand totals.

    ``rows`` is ordered by ``order_count`` desc. Only ``active`` (confirmed /
    imported) orders with a campaign tag are counted; drafts, pending, void,
    refunded/cancelled and untagged orders are excluded by the service.
    ``grand_total_paid`` is **net** of refunds (partial refunds netted via
    ``refunded_amount``; full refunds / cancels excluded entirely).
    """

    rows: List[CampaignSummaryRow]
    total_campaigns: int
    grand_total_orders: int
    grand_total_paid: Decimal
    grand_total_refunded: Decimal
    grand_total_listed: Decimal
    grand_total_discount: Decimal
    date_from: Optional[date] = None
    date_to: Optional[date] = None


class IssueSummaryRow(BaseModel):
    """One single-issue's sales roll-up (keyed by publication + issue_label)."""

    publication: str
    issue_label: str
    line_count: int
    total_quantity: int
    total_paid: Decimal


class IssueSummaryOut(BaseModel):
    """Per-issue sales summary for single-issue lines that carry an
    ``issue_label`` (chiefly 商学院 monthly issues). Ordered by publication then
    issue_label. Only ``active`` orders count (drafts/pending/void excluded);
    refunds not netted out.
    """

    rows: List[IssueSummaryRow]
    total_issues: int
    grand_total_quantity: int
    grand_total_paid: Decimal
    date_from: Optional[date] = None
    date_to: Optional[date] = None


class BsCirculationRow(BaseModel):
    """商学院某一期的「发行量」= 单期销量 + 覆盖该期的订阅份数。

    ``subscription_qty`` 由订阅覆盖期落到刊历上展开得到（合刊只计一次）。
    ``in_calendar=False`` 表示该期有单期销量但不在刊历里 —— 订阅无法展开到它
    （提示把这期补进刊历）。
    """

    issue_label: str
    year: Optional[int] = None
    title: Optional[str] = None
    single_issue_qty: int
    subscription_qty: int
    total_qty: int
    in_calendar: bool = True


class BsCirculationOut(BaseModel):
    """商学院按期发行量（单期 + 订阅）。只计 ``active`` 订单。

    ``unexpanded_subscriptions`` = 缺覆盖期、无法展开到具体期的商学院订阅张数
    （历史归档 / 未配起投月）—— 这些没计入任何一期，单独提示。
    """

    rows: List[BsCirculationRow]
    grand_total_single: int
    grand_total_subscription: int
    grand_total: int
    unexpanded_subscriptions: int
    year: Optional[int] = None
