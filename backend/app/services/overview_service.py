"""ZTO-MF 跨期总览聚合（工作台 + 期数总览）。

一次性用 2 个批量查询把「刊历全集 → 是否开期 → 发货汇总 → 中通报数 → 确认漂移 →
最近操作时间」拼齐，服务端按 D2 优先级算好每期 status，前端只读不重算。

- delta = 报数 − 发货（D1，正数=发货缺口/少发）。
- workbench：强制本年（date.today().year），带 KPI + 3 提醒 + 最近/后续期数 + 本月最新更新。
- periods：year 可选（不传=全部年份，D5），只返回行 + KPI。
- 休刊行（is_suspended 或 issue_number 空）整行剔除，不进任何计数/分母。
- 最后更新时间取「该期任何操作」（operation_logs），回退发货明细/刊期更新时间（决策③）。
  历史 operation_logs 行 issue_number 为空、取不到，即回退到发货明细更新时间。
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    Issue,
    IssueAuditSnapshot,
    OperationLog,
    PublicationSchedule,
    ShippingDetail,
    ShippingDetailSourceType,
)
from app.schemas.analytics import (
    LatestUpdateOut,
    OverviewExtrasOut,
    OverviewKpiOut,
    OverviewOut,
    OverviewReminderOut,
    PeriodRowOut,
)
from app.services.issue_service import compute_zt_report_totals

_RECENT_LIMIT = 5
_UPCOMING_LIMIT = 5


def _compute_status(
    issue_id: int | None,
    issue_status: str | None,
    detail_count: int,
    delta: int,
    has_drift: bool,
) -> tuple[str, str]:
    """D2 首个命中即止（休刊已在上游剔除）。返回 (status, 异常说明)。"""
    if issue_id is None:
        return "未创建", "尚未创建期数"
    if issue_status == "draft":
        return "草稿", "草稿未提交"
    if detail_count > 0 and (delta != 0 or has_drift):
        if delta > 0:
            note = "发货份数少于报数份数"
        elif delta < 0:
            note = "发货份数多于报数份数"
        else:
            note = "确认后明细已变更"
        return "异常", note
    if detail_count == 0:
        return "待上传", "等待上传发货明细"
    return "已上传", "—"


def build_overview(db: Session, scope: str = "workbench", year: int | None = None) -> OverviewOut:
    today = date.today()
    if scope == "workbench":
        year = today.year  # 工作台恒为本年（D5）

    shipping_totals = (
        db.query(
            ShippingDetail.issue_number.label("issue_number"),
            func.coalesce(func.sum(ShippingDetail.quantity), 0).label("shipping_total"),
            func.count(ShippingDetail.id).label("detail_count"),
            func.max(ShippingDetail.updated_at).label("shipping_updated_at"),
        )
        .filter(ShippingDetail.source_type != ShippingDetailSourceType.complaint_makeup)
        .group_by(ShippingDetail.issue_number)
        .subquery()
    )
    operation_updates = (
        db.query(
            OperationLog.issue_number.label("issue_number"),
            func.max(OperationLog.created_at).label("operation_updated_at"),
        )
        .filter(OperationLog.issue_number.isnot(None))
        .group_by(OperationLog.issue_number)
        .subquery()
    )
    latest_confirm_shipping = (
        select(IssueAuditSnapshot.shipping_total)
        .where(
            IssueAuditSnapshot.issue_id == Issue.id,
            IssueAuditSnapshot.snapshot_type == "confirm",
        )
        .order_by(IssueAuditSnapshot.created_at.desc(), IssueAuditSnapshot.id.desc())
        .limit(1)
        .correlate(Issue)
        .scalar_subquery()
    )
    overview_query = (
        db.query(
            PublicationSchedule,
            Issue.id.label("issue_id"),
            Issue.status.label("issue_status"),
            Issue.updated_at.label("issue_updated_at"),
            func.coalesce(shipping_totals.c.shipping_total, 0).label("shipping_total"),
            func.coalesce(shipping_totals.c.detail_count, 0).label("detail_count"),
            shipping_totals.c.shipping_updated_at,
            latest_confirm_shipping.label("confirmed_shipping_total"),
            operation_updates.c.operation_updated_at,
        )
        .outerjoin(Issue, Issue.issue_number == PublicationSchedule.issue_number)
        .outerjoin(
            shipping_totals,
            shipping_totals.c.issue_number == PublicationSchedule.issue_number,
        )
        .outerjoin(
            operation_updates,
            operation_updates.c.issue_number == PublicationSchedule.issue_number,
        )
        .filter(
            PublicationSchedule.is_suspended.is_(False),
            PublicationSchedule.issue_number.isnot(None),
        )
    )
    if year is not None:
        overview_query = overview_query.filter(PublicationSchedule.year == year)
    joined_rows = overview_query.order_by(
        PublicationSchedule.year, PublicationSchedule.publish_date
    ).all()

    schedule_rows = [row[0] for row in joined_rows]
    issue_map: dict[int, tuple] = {}
    ship_map: dict[int, tuple] = {}
    confirm_ship: dict[int, int] = {}
    op_updated: dict[int, object] = {}
    for (
        schedule,
        issue_id,
        issue_status,
        issue_updated_at,
        shipping_total,
        detail_count,
        shipping_updated_at,
        confirmed_shipping_total,
        operation_updated_at,
    ) in joined_rows:
        number = schedule.issue_number
        if issue_id is not None:
            issue_map[number] = (
                issue_id,
                issue_status.value if issue_status is not None else None,
                issue_updated_at,
            )
            if confirmed_shipping_total is not None:
                confirm_ship[issue_id] = int(confirmed_shipping_total)
        ship_map[number] = (
            int(shipping_total or 0),
            int(detail_count or 0),
            shipping_updated_at,
        )
        if operation_updated_at is not None:
            op_updated[number] = operation_updated_at

    # Query 2: destination semantics include legacy category fallbacks and are
    # deliberately preserved in the shared Python resolver.
    issue_ids = [value[0] for value in issue_map.values()]
    zt_totals = compute_zt_report_totals(db, issue_ids)

    rows: list[PeriodRowOut] = []
    for s in schedule_rows:
        num = s.issue_number
        issue = issue_map.get(num)
        issue_id = issue[0] if issue else None
        issue_status = issue[1] if issue else None
        issue_updated = issue[2] if issue else None

        ship = ship_map.get(num)
        shipping_total = ship[0] if ship else 0
        detail_count = ship[1] if ship else 0
        ship_updated = ship[2] if ship else None

        report_zt_total = zt_totals.get(issue_id, 0) if issue_id is not None else 0
        has_drift = issue_id in confirm_ship and shipping_total != confirm_ship[issue_id]
        delta = report_zt_total - shipping_total
        status, note = _compute_status(issue_id, issue_status, detail_count, delta, has_drift)

        last_updated_at = op_updated.get(num) or ship_updated or issue_updated

        rows.append(
            PeriodRowOut(
                issue_number=num,
                issue_id=issue_id,
                year=s.year,
                publish_date=s.publish_date,
                status=status,
                report_zt_total=report_zt_total,
                shipping_total=shipping_total,
                delta=delta,
                is_match=delta == 0,
                detail_count=detail_count,
                has_shipping_drift=has_drift,
                exception_note=note,
                last_updated_at=last_updated_at,
            )
        )

    kpi = OverviewKpiOut(
        total=len(rows),
        uploaded=sum(1 for r in rows if r.status == "已上传"),
        pending=sum(1 for r in rows if r.status == "待上传"),
        uncreated=sum(1 for r in rows if r.status == "未创建"),
        exception=sum(1 for r in rows if r.status == "异常"),
        draft=sum(1 for r in rows if r.status == "草稿"),
    )

    extras = None
    if scope == "workbench":
        recent = sorted(
            (r for r in rows if r.issue_id is not None),
            key=lambda r: r.issue_number,
            reverse=True,
        )[:_RECENT_LIMIT]
        upcoming = sorted(
            (r for r in rows if r.publish_date >= today),
            key=lambda r: r.publish_date,
        )[:_UPCOMING_LIMIT]
        reminders = OverviewReminderOut(
            no_shipping_count=kpi.pending + kpi.uncreated,  # 待上传含未创建（决策②）
            delta_diff_count=sum(1 for r in rows if r.status == "异常" and r.delta != 0),
            draft_unconfirmed_count=kpi.draft,
        )
        this_month = [
            r
            for r in rows
            if r.last_updated_at is not None
            and r.last_updated_at.year == today.year
            and r.last_updated_at.month == today.month
        ]
        latest_this_month = None
        if this_month:
            top = max(this_month, key=lambda r: r.last_updated_at)
            latest_this_month = LatestUpdateOut(
                issue_number=top.issue_number,
                last_updated_at=top.last_updated_at,
                status=top.status,
            )
        extras = OverviewExtrasOut(
            recent_issues=recent,
            upcoming_issues=upcoming,
            reminders=reminders,
            latest_this_month=latest_this_month,
        )

    return OverviewOut(scope=scope, year=year, rows=rows, kpi=kpi, extras=extras)
