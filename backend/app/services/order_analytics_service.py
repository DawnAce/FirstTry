"""Sales analytics aggregations (read-only, GROUP BY reporting).

Distinct from the other reporting layers:

* ``order_service``       — per-order CRUD + drift computation.
* ``reports`` / ``exports`` — print-run reporting *by issue* (how many copies
  to print/ship).

This module answers *commercial* questions — "how did each marketing campaign
sell?" — by grouping orders on their ``campaign`` tag. The tag is written per
import batch (e.g. ``"2026-618"``, ``"2026-双十一"``) and carries the year, so
campaigns stay distinguishable across years WITHOUT the year living in any
product name.

V1 scope: per-campaign + per-issue summaries. Only ``active`` orders are counted
(imported orders are created ``active``; manual orders become ``active`` on
confirm) — drafts, pending_confirmation and void are excluded, so un-confirmed
rows never inflate the numbers. Platform refunds (``commercial_status``) are NOT
netted out yet; ``total_paid`` is the gross sum over active orders.
"""

from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.order import Order, OrderStatus
from app.models.order_item import FulfillmentType, OrderItem, Publication
from app.schemas.analytics import (
    CampaignSummaryOut,
    CampaignSummaryRow,
    IssueSummaryOut,
    IssueSummaryRow,
)


def _money(value) -> Decimal:
    """Coerce a SQL SUM result (Decimal under MySQL, float under SQLite) to a
    2-dp Decimal so the response is exact regardless of backend."""
    return Decimal(str(value or 0)).quantize(Decimal("0.01"))


def summarize_campaigns(
    db: Session,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
) -> CampaignSummaryOut:
    """Per-campaign order count + revenue, biggest campaign first.

    Only ``active`` orders carrying a non-NULL ``campaign`` tag are included —
    manual / untagged orders are not part of a *campaign* report, and
    drafts/pending/void are excluded. The optional ``order_date`` range
    (inclusive on both ends) narrows the reporting window.
    """
    # 原价缺失（手工 / 历史单）时按"无折扣"计：COALESCE(原价, 实付)。
    listed_expr = func.coalesce(Order.original_amount, Order.paid_amount)
    q = (
        db.query(
            Order.campaign,
            func.count(Order.id),
            func.sum(Order.paid_amount),
            func.sum(listed_expr),
        )
        .filter(Order.campaign.isnot(None))
        .filter(Order.status == OrderStatus.active)
    )
    if date_from is not None:
        q = q.filter(Order.order_date >= date_from)
    if date_to is not None:
        q = q.filter(Order.order_date <= date_to)
    q = q.group_by(Order.campaign).order_by(
        func.count(Order.id).desc(), Order.campaign.asc()
    )

    rows = []
    for campaign, order_count, paid, listed in q.all():
        paid_m, listed_m = _money(paid), _money(listed)
        rows.append(
            CampaignSummaryRow(
                campaign=campaign,
                order_count=order_count,
                total_paid=paid_m,
                total_listed=listed_m,
                total_discount=_money(listed_m - paid_m),
            )
        )
    return CampaignSummaryOut(
        rows=rows,
        total_campaigns=len(rows),
        grand_total_orders=sum(r.order_count for r in rows),
        grand_total_paid=_money(sum((r.total_paid for r in rows), Decimal("0"))),
        grand_total_listed=_money(sum((r.total_listed for r in rows), Decimal("0"))),
        grand_total_discount=_money(sum((r.total_discount for r in rows), Decimal("0"))),
        date_from=date_from,
        date_to=date_to,
    )


def summarize_issues(
    db: Session,
    publication: Optional[Publication] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
) -> IssueSummaryOut:
    """Per-issue copies sold + revenue for single-issue lines.

    Only ``single_issue`` order items that carry a normalised ``issue_label``
    are counted — chiefly 商学院 monthly issues ("2026-01"), whose identity has
    no home in the (subscription-shaped) product catalog. Only lines on
    ``active`` orders are counted (drafts/pending/void excluded). ``total_quantity``
    is copies sold; ``total_paid`` sums the line ``subtotal``.
    """
    q = (
        db.query(
            OrderItem.publication,
            OrderItem.issue_label,
            func.count(OrderItem.id),
            func.sum(OrderItem.total_quantity),
            func.sum(OrderItem.subtotal),
        )
        .join(Order, OrderItem.order_id == Order.id)
        .filter(OrderItem.fulfillment_type == FulfillmentType.single_issue)
        .filter(OrderItem.issue_label.isnot(None))
        .filter(Order.status == OrderStatus.active)
    )
    if publication is not None:
        q = q.filter(OrderItem.publication == publication)
    if date_from is not None:
        q = q.filter(Order.order_date >= date_from)
    if date_to is not None:
        q = q.filter(Order.order_date <= date_to)
    q = q.group_by(OrderItem.publication, OrderItem.issue_label).order_by(
        OrderItem.publication.asc(), OrderItem.issue_label.asc()
    )

    rows = [
        IssueSummaryRow(
            publication=pub.value if hasattr(pub, "value") else str(pub),
            issue_label=label,
            line_count=line_count,
            total_quantity=int(qty or 0),
            total_paid=_money(paid),
        )
        for pub, label, line_count, qty, paid in q.all()
    ]
    return IssueSummaryOut(
        rows=rows,
        total_issues=len(rows),
        grand_total_quantity=sum(r.total_quantity for r in rows),
        grand_total_paid=_money(sum((r.total_paid for r in rows), Decimal("0"))),
        date_from=date_from,
        date_to=date_to,
    )
