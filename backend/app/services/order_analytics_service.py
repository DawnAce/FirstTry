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

import calendar as _calendar
from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.bs_issue import BsIssue
from app.models.order import Order, OrderStatus
from app.models.order_item import FulfillmentType, OrderItem, Publication
from app.schemas.analytics import (
    BsCirculationOut,
    BsCirculationRow,
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


def _issue_covers(issue: BsIssue, cov_start: date, cov_end: date) -> bool:
    """该刊历期 [起月1号, 止月月末] 是否与订阅覆盖期 [cov_start, cov_end] 有交集。

    用「月区间是否重叠覆盖期」判定——覆盖期落到合刊任一月即算命中（合刊整体只一期，
    用 issue_label 去重）。
    """
    first = date(issue.year, issue.month_start, 1)
    last_day = _calendar.monthrange(issue.year, issue.month_end)[1]
    last = date(issue.year, issue.month_end, last_day)
    return first <= cov_end and last >= cov_start


def summarize_bs_circulation(db: Session, year: Optional[int] = None) -> BsCirculationOut:
    """商学院按期发行量 = 单期销量 + 覆盖该期的订阅份数（含合刊去重）。

    只计 ``active`` 订单。订阅按 ``[coverage_start, coverage_end]`` 落到商学院刊历
    (``bs_issues``) 上展开成命中的各期，每张订阅在一期里计 ``total_quantity`` 份、合刊只
    计一次。缺覆盖期的订阅无法展开 → 计入 ``unexpanded_subscriptions`` 单独提示，不入任
    何一期。某期有单期销量但不在刊历 → 仍列出（``in_calendar=False``），但订阅展不到它。
    """
    cal_q = db.query(BsIssue)
    if year is not None:
        cal_q = cal_q.filter(BsIssue.year == year)
    calendar_rows = cal_q.order_by(BsIssue.year, BsIssue.month_start).all()

    acc: dict[str, dict] = {
        b.issue_label: {
            "year": b.year,
            "title": b.title,
            "sort": (b.year, b.month_start),
            "single": 0,
            "subscription": 0,
            "in_calendar": True,
        }
        for b in calendar_rows
    }

    # 单期销量（商学院 single_issue + issue_label）
    si_q = (
        db.query(OrderItem.issue_label, func.sum(OrderItem.total_quantity))
        .join(Order, OrderItem.order_id == Order.id)
        .filter(OrderItem.publication == Publication.business_school)
        .filter(OrderItem.fulfillment_type == FulfillmentType.single_issue)
        .filter(OrderItem.issue_label.isnot(None))
        .filter(Order.status == OrderStatus.active)
        .group_by(OrderItem.issue_label)
    )
    if year is not None:
        si_q = si_q.filter(OrderItem.issue_label.like(f"{year}-%"))
    for label, qty in si_q.all():
        if label not in acc:
            # 卖出过但不在刊历的期：仍列出（订阅无法展开到它）。排序键放该年最后。
            yr = int(label[:4]) if label[:4].isdigit() else 0
            acc[label] = {"year": yr or None, "title": None, "sort": (yr, 99),
                          "single": 0, "subscription": 0, "in_calendar": False}
        acc[label]["single"] += int(qty or 0)

    # 订阅：覆盖期展开到刊历各期（合刊去重，靠 issue_label 唯一）
    subs = (
        db.query(OrderItem)
        .join(Order, OrderItem.order_id == Order.id)
        .filter(OrderItem.publication == Publication.business_school)
        .filter(OrderItem.fulfillment_type == FulfillmentType.subscription)
        .filter(Order.status == OrderStatus.active)
        .filter(OrderItem.coverage_start_date.isnot(None))
        .filter(OrderItem.coverage_end_date.isnot(None))
        .all()
    )
    for item in subs:
        for b in calendar_rows:
            if _issue_covers(b, item.coverage_start_date, item.coverage_end_date):
                acc[b.issue_label]["subscription"] += int(item.total_quantity or 0)

    # 缺覆盖期、无法展开的商学院订阅张数
    unexpanded = (
        db.query(func.count(OrderItem.id))
        .join(Order, OrderItem.order_id == Order.id)
        .filter(OrderItem.publication == Publication.business_school)
        .filter(OrderItem.fulfillment_type == FulfillmentType.subscription)
        .filter(Order.status == OrderStatus.active)
        .filter(
            (OrderItem.coverage_start_date.is_(None))
            | (OrderItem.coverage_end_date.is_(None))
        )
        .scalar()
    ) or 0

    rows = []
    for label, a in sorted(acc.items(), key=lambda kv: kv[1]["sort"]):
        total = a["single"] + a["subscription"]
        rows.append(
            BsCirculationRow(
                issue_label=label,
                year=a["year"],
                title=a["title"],
                single_issue_qty=a["single"],
                subscription_qty=a["subscription"],
                total_qty=total,
                in_calendar=a["in_calendar"],
            )
        )
    return BsCirculationOut(
        rows=rows,
        grand_total_single=sum(r.single_issue_qty for r in rows),
        grand_total_subscription=sum(r.subscription_qty for r in rows),
        grand_total=sum(r.total_qty for r in rows),
        unexpanded_subscriptions=int(unexpanded),
        year=year,
    )
