"""Sales analytics REST API (read-only).

Mounted under ``/api/analytics`` (auth applied at router-include time in
``main.py``). Thin wrapper over ``order_analytics_service`` — aggregation logic
lives there.

Endpoint map:

* ``GET /api/analytics/campaigns`` — per-campaign order count + revenue
"""

from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import User
from app.models.order_item import Publication
from app.schemas.analytics import (
    BsCirculationOut,
    CampaignSummaryOut,
    IssueSummaryOut,
    OutstandingSummary,
    OverviewOut,
)
from app.services import order_analytics_service, overview_service
from app.cache import get_overview_cache, set_overview_cache

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/campaigns", response_model=CampaignSummaryOut)
def campaign_summary(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Per-campaign sales summary (order count + revenue).

    Excludes void orders and untagged (NULL-campaign) orders. Optional
    ``date_from`` / ``date_to`` filter on ``order_date`` (inclusive).
    """
    return order_analytics_service.summarize_campaigns(
        db, date_from=date_from, date_to=date_to
    )


@router.get("/issues", response_model=IssueSummaryOut)
def issue_summary(
    publication: Optional[Publication] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Per-issue sales summary (copies + revenue) for single-issue lines.

    Counts only single-issue items carrying a normalised ``issue_label``
    (chiefly 商学院 monthly issues). Excludes void orders. Optional
    ``publication`` and ``date_from`` / ``date_to`` (on ``order_date``) filters.
    """
    return order_analytics_service.summarize_issues(
        db, publication=publication, date_from=date_from, date_to=date_to
    )


@router.get("/bs-circulation", response_model=BsCirculationOut)
def bs_circulation(
    year: Optional[int] = None,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """商学院按期发行量（单期销量 + 覆盖该期的订阅份数）。

    订阅按覆盖期落到商学院刊历（``bs_issues``）展开成命中的各期，合刊只计一次。
    可选 ``year`` 限定年份。缺覆盖期的订阅在 ``unexpanded_subscriptions`` 单独提示。
    只计 active 订单。
    """
    return order_analytics_service.summarize_bs_circulation(db, year=year)


@router.get("/outstanding", response_model=OutstandingSummary)
def outstanding_summary(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """欠款汇总：应收/实付/欠款 合计 + 未付清单数。只计 active 且非退款/取消单。
    欠款按逐单 max(0, 应收 − 实付) 求和。"""
    return order_analytics_service.summarize_outstanding(db)


@router.get("/overview", response_model=OverviewOut)
def logistics_overview(
    scope: Literal["workbench", "periods"] = "workbench",
    year: Optional[int] = None,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """ZTO-MF 跨期总览。

    ``scope=workbench`` 返回本年概况 + KPI + 3 待处理提醒 + 最近/后续期数 + 本月最新更新；
    ``scope=periods`` 返回全部年份（``year`` 可选过滤）的期表 + KPI。缓存 30s，写操作即失效。
    """
    key_year = year if scope == "periods" else None
    cached = get_overview_cache(scope, key_year)
    if cached is not None:
        return cached
    result = overview_service.build_overview(db, scope=scope, year=year)
    set_overview_cache(scope, key_year, result)
    return result
