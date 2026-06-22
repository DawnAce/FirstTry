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

    ``total_listed`` is the pre-discount 原价 total (``COALESCE(original_amount,
    paid_amount)`` summed — orders with no captured list price count as
    no-discount). ``total_discount = total_listed - total_paid`` is the campaign's
    discount depth in ¥.
    """

    campaign: str
    order_count: int
    total_paid: Decimal
    total_listed: Decimal
    total_discount: Decimal


class CampaignSummaryOut(BaseModel):
    """Per-campaign sales summary + grand totals.

    ``rows`` is ordered by ``order_count`` desc. Only ``active`` (confirmed /
    imported) orders with a campaign tag are counted; drafts, pending, void and
    untagged orders are excluded by the service. Platform refunds are NOT netted
    out — ``total_paid`` is the gross sum over active orders.
    """

    rows: List[CampaignSummaryRow]
    total_campaigns: int
    grand_total_orders: int
    grand_total_paid: Decimal
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
