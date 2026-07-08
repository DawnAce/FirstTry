"""Pydantic schemas for sales analytics (per-campaign, per-issue, …).

These rows are assembled by the service layer via GROUP BY aggregation, so
they are plain ``BaseModel``s (not ``from_attributes`` ORM projections).
"""

from datetime import date, datetime
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


class OutstandingSummary(BaseModel):
    """欠款汇总：只计 active 且非退款/取消单。欠款 = Σ max(0, 应收 − 实付)。"""

    total_receivable: Decimal   # Σ 应收(total_amount)
    total_paid: Decimal         # Σ 实付(paid_amount)
    total_outstanding: Decimal  # Σ max(0, 应收 − 实付)
    unpaid_orders: int          # 未付清订单数(实付 < 应收)


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


# --- ZTO-MF 跨期总览（工作台 + 期数总览）---------------------------------------

class PeriodRowOut(BaseModel):
    """某一期的物流总览行（服务端算好 status，前端不重算）。delta = 报数 − 发货。"""

    issue_number: int
    issue_id: Optional[int] = None
    year: int
    publish_date: date
    status: str            # 未创建 / 草稿 / 异常 / 待上传 / 已上传
    report_zt_total: int   # 报数·中通合计
    shipping_total: int    # 发货明细·合计
    delta: int             # 报数 − 发货（正数=发货缺口/少发）
    is_match: bool
    detail_count: int
    has_shipping_drift: bool
    exception_note: str
    last_updated_at: Optional[datetime] = None


class OverviewKpiOut(BaseModel):
    """总览 KPI 计数（均不含休刊）。工作台"待上传"卡 = pending + uncreated（决策②）。"""

    total: int
    uploaded: int
    pending: int      # 已开期、无发货明细
    uncreated: int    # 刊历有此期、系统未建
    exception: int
    draft: int


class OverviewReminderOut(BaseModel):
    """工作台待处理提醒（3 项，本年）。"""

    no_shipping_count: int         # 尚未上传发货明细（待上传 + 未创建）
    delta_diff_count: int          # 报数与发货差异（异常且 delta≠0）
    draft_unconfirmed_count: int   # 草稿未确认


class LatestUpdateOut(BaseModel):
    issue_number: int
    last_updated_at: datetime
    status: str


class OverviewExtrasOut(BaseModel):
    """仅 scope=workbench 返回。"""

    recent_issues: List[PeriodRowOut]
    upcoming_issues: List[PeriodRowOut]
    reminders: OverviewReminderOut
    latest_this_month: Optional[LatestUpdateOut] = None


class OverviewOut(BaseModel):
    scope: str                       # workbench | periods
    year: Optional[int] = None
    rows: List[PeriodRowOut]
    kpi: OverviewKpiOut
    extras: Optional[OverviewExtrasOut] = None
