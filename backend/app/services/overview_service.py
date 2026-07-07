"""ZTO-MF 跨期总览聚合（工作台 + 期数总览）。

一次性用 ~6 个批量查询把「刊历全集 → 是否开期 → 发货汇总 → 中通报数 → 确认漂移 →
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

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import (
    Issue,
    IssueAuditSnapshot,
    OperationLog,
    PublicationSchedule,
    ShippingDetail,
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

_RECENT_LIMIT = 10
_UPCOMING_LIMIT = 8


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

    # Q1: 刊历全集（驱动，剔休刊）。
    q1 = db.query(PublicationSchedule).filter(
        PublicationSchedule.is_suspended.is_(False),
        PublicationSchedule.issue_number.isnot(None),
    )
    if year is not None:
        q1 = q1.filter(PublicationSchedule.year == year)
    schedule_rows = q1.order_by(
        PublicationSchedule.year, PublicationSchedule.publish_date
    ).all()

    issue_numbers = [s.issue_number for s in schedule_rows]

    # Q2: 已开期（issues）→ issue_number -> (id, status, updated_at)。
    issue_map: dict[int, tuple] = {}
    if issue_numbers:
        for iid, num, status, updated_at in (
            db.query(Issue.id, Issue.issue_number, Issue.status, Issue.updated_at)
            .filter(Issue.issue_number.in_(issue_numbers))
            .all()
        ):
            issue_map[num] = (iid, status.value if status is not None else None, updated_at)

    issue_ids = [v[0] for v in issue_map.values()]

    # Q3: 发货明细按期汇总（Σ份数 / 条数 / 最近更新）。
    ship_map: dict[int, tuple] = {}
    if issue_numbers:
        for num, ship_total, cnt, ship_updated in (
            db.query(
                ShippingDetail.issue_number,
                func.coalesce(func.sum(ShippingDetail.quantity), 0),
                func.count(ShippingDetail.id),
                func.max(ShippingDetail.updated_at),
            )
            .filter(ShippingDetail.issue_number.in_(issue_numbers))
            .group_by(ShippingDetail.issue_number)
            .all()
        ):
            ship_map[num] = (int(ship_total or 0), int(cnt or 0), ship_updated)

    # Q4: 中通报数合计（批量，逐字对齐 get_report）。
    zt_totals = compute_zt_report_totals(db, issue_ids)

    # Q5: 每期最新 confirm 快照的发货合计 → 算漂移（confirms 相隔数秒，取 max(created_at) 即可）。
    confirm_ship: dict[int, int] = {}
    if issue_ids:
        latest_sub = (
            db.query(
                IssueAuditSnapshot.issue_id,
                func.max(IssueAuditSnapshot.created_at).label("mx"),
            )
            .filter(
                IssueAuditSnapshot.snapshot_type == "confirm",
                IssueAuditSnapshot.issue_id.in_(issue_ids),
            )
            .group_by(IssueAuditSnapshot.issue_id)
            .subquery()
        )
        for iid, snap_ship in (
            db.query(IssueAuditSnapshot.issue_id, IssueAuditSnapshot.shipping_total)
            .join(
                latest_sub,
                (IssueAuditSnapshot.issue_id == latest_sub.c.issue_id)
                & (IssueAuditSnapshot.created_at == latest_sub.c.mx),
            )
            .all()
        ):
            confirm_ship[iid] = snap_ship

    # Q6: 每期最近一次「任何操作」时间（决策③；历史行 issue_number 为空不计）。
    op_updated: dict[int, object] = {}
    if issue_numbers:
        for num, mx in (
            db.query(OperationLog.issue_number, func.max(OperationLog.created_at))
            .filter(OperationLog.issue_number.in_(issue_numbers))
            .group_by(OperationLog.issue_number)
            .all()
        ):
            op_updated[num] = mx

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
