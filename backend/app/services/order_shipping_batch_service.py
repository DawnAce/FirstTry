"""按期批量排发 + 漏期报表 + 单订单同步全部期。

全部复用 ``order_shipping_sync_service`` 的单订单×单期逻辑，只在外面包一层：

* ``gap_report``                 —— 某期「谁该排却没排」（只读）。
* ``apply_all_for_issue``        —— 某期一键排发所有活跃订单（冲突单不中断整批）。
* ``apply_all_issues_for_order`` —— 单订单覆盖期内所有期一次排齐（补录老单后用）。

设计要点：
* 订单集合 = ``active`` + **非历史归档** + 有 active 纸刊明细「覆盖该期」（订阅按覆盖期、
  单期按 issue_number）。历史归档单按现有业务规则排除。
* 批量先 ``preview`` 再 ``apply``：冲突单（人工改过的行）只报告、**不 apply、不中断**，
  绝不自动覆盖人工修改。
* 每单独立提交（``apply`` 内部 commit）—— 已排的订单不会因后面某单失败而回滚。
* 不建表、不加列：纯计算 + 复用现有 ``shipping_details`` 同步。
"""

from __future__ import annotations

from datetime import date, datetime, time
from typing import Optional

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.models import (
    Issue,
    Order,
    OrderItem,
    OrderItemStatus,
    OrderStatus,
    PublicationSchedule,
    ShippingDetail,
    ShippingDetailSourceType,
    ShippingDetailSyncStatus,
    User,
)
from app.models.order_item import FulfillmentType, PublicationFormat
from app.schemas.order import (
    BatchSyncConflict,
    BatchSyncSummary,
    IssueGapReport,
    IssueGapRow,
    IssueReconciliation,
    OrderAllIssuesSyncSummary,
    ReconUnshippedRow,
    ShipBatchResult,
)
from app.services.order_shipping_sync_service import (
    COVERAGE_BASED_FULFILLMENT_TYPES,
    _get_issue,
    _get_order,
    _is_suspended_issue,
    apply_order_shipping_sync,
    preview_order_shipping_sync,
)
from app.services.operation_log_service import record_operation

_SINGLE_ISSUE_TYPES = (FulfillmentType.single_issue, FulfillmentType.makeup)


def _candidate_order_ids_for_issue(db: Session, issue: Issue) -> list[int]:
    """Active, non-archived orders with a paper item that targets this issue.

    Coverage-based items qualify when the issue's ``publish_date`` falls in
    ``[coverage_start, coverage_end]`` (NULL end = open-ended → still surfaced so
    the report can flag 覆盖期缺失); single-issue / makeup items qualify when
    ``issue_number`` matches. A coarse filter — the precise per-recipient decision
    is re-derived by ``preview_order_shipping_sync`` per order.
    """
    pub = issue.publish_date
    coverage_clause = and_(
        OrderItem.fulfillment_type.in_(tuple(COVERAGE_BASED_FULFILLMENT_TYPES)),
        or_(
            OrderItem.coverage_start_date.is_(None),
            OrderItem.coverage_start_date <= pub,
        ),
        or_(
            OrderItem.coverage_end_date.is_(None),
            OrderItem.coverage_end_date >= pub,
        ),
    )
    single_clause = and_(
        OrderItem.fulfillment_type.in_(_SINGLE_ISSUE_TYPES),
        OrderItem.issue_number == issue.issue_number,
    )
    rows = (
        db.query(Order.id)
        .join(OrderItem, OrderItem.order_id == Order.id)
        .filter(Order.status == OrderStatus.active)
        .filter(Order.is_historical_archive.is_(False))
        .filter(OrderItem.status == OrderItemStatus.active)
        .filter(OrderItem.publication_format == PublicationFormat.paper)
        .filter(or_(coverage_clause, single_clause))
        .distinct()
        .order_by(Order.id)
        .all()
    )
    return [r[0] for r in rows]


def _order_code_map(db: Session, order_ids: list[int]) -> dict[int, str | None]:
    if not order_ids:
        return {}
    return {
        oid: code
        for oid, code in db.query(Order.id, Order.order_code)
        .filter(Order.id.in_(order_ids))
        .all()
    }


def gap_report(db: Session, issue_number: int) -> IssueGapReport:
    """某期「谁该排却没排」（只读，不写库）。"""
    issue = _get_issue(db, issue_number)
    report = IssueGapReport(issue_number=issue_number, publish_date=issue.publish_date)
    if _is_suspended_issue(db, issue):
        report.suspended = True
        return report

    order_ids = _candidate_order_ids_for_issue(db, issue)
    report.total_orders = len(order_ids)
    code_map = _order_code_map(db, order_ids)

    for oid in order_ids:
        preview = preview_order_shipping_sync(db, oid, issue_number)
        for it in preview.items:
            row = IssueGapRow(
                order_id=oid,
                order_code=code_map.get(oid),
                order_item_id=it.order_item_id,
                fulfillment_target_id=it.fulfillment_target_id,
                recipient_name=it.name,
                quantity=it.quantity,
                reason=it.reason,
            )
            if it.action == "create":
                report.missing.append(row)
            elif it.action == "update":
                report.stale.append(row)
            elif it.action == "conflict":
                report.conflict.append(row)
            elif it.action == "skip":
                # 已同步无变化的行带 shipping_detail_id；因故跳过的候选则没有。
                if it.shipping_detail_id is not None:
                    report.synced_count += 1
                else:
                    report.skipped.append(row)
    return report


def apply_all_for_issue(
    db: Session, issue_number: int, operator_id: int | None
) -> BatchSyncSummary:
    """某期一键排发所有活跃订单。冲突单不 apply、计入汇总、不中断整批。"""
    issue = _get_issue(db, issue_number)
    summary = BatchSyncSummary(issue_number=issue_number)
    if _is_suspended_issue(db, issue):
        summary.suspended = True
        summary.message = "目标期号为休刊期，不生成发货明细"
        return summary

    order_ids = _candidate_order_ids_for_issue(db, issue)
    summary.orders_total = len(order_ids)
    code_map = _order_code_map(db, order_ids)

    for oid in order_ids:
        preview = preview_order_shipping_sync(db, oid, issue_number)
        # 汇总跳过原因（item 级；已同步无变化的不算跳过）。
        for it in preview.items:
            if it.action == "skip" and it.shipping_detail_id is None and it.reason:
                summary.skipped_reasons[it.reason] = (
                    summary.skipped_reasons.get(it.reason, 0) + 1
                )

        if preview.summary.conflicts:
            summary.orders_conflict += 1
            summary.conflicts.append(
                BatchSyncConflict(
                    order_id=oid,
                    order_code=code_map.get(oid),
                    conflict_count=preview.summary.conflicts,
                )
            )
            continue

        if preview.summary.to_create or preview.summary.to_update:
            apply_order_shipping_sync(db, oid, issue_number, operator_id)
            summary.rows_created += preview.summary.to_create
            summary.rows_updated += preview.summary.to_update
            summary.orders_applied += 1
        elif preview.summary.candidates == 0:
            summary.orders_skipped += 1
        else:
            summary.orders_unchanged += 1

    return summary


def _expected_issue_numbers_for_order(db: Session, order: Order) -> set[int]:
    """Issue numbers this order's active paper items target (single + coverage)."""
    numbers: set[int] = set()
    for item in order.items:
        if item.status != OrderItemStatus.active:
            continue
        if item.publication_format != PublicationFormat.paper:
            continue
        if item.fulfillment_type in _SINGLE_ISSUE_TYPES:
            if item.issue_number is not None:
                numbers.add(item.issue_number)
        elif item.fulfillment_type in COVERAGE_BASED_FULFILLMENT_TYPES:
            if item.coverage_start_date and item.coverage_end_date:
                rows = (
                    db.query(PublicationSchedule.issue_number)
                    .filter(
                        PublicationSchedule.publish_date >= item.coverage_start_date,
                        PublicationSchedule.publish_date <= item.coverage_end_date,
                        PublicationSchedule.issue_number.isnot(None),
                    )
                    .all()
                )
                numbers.update(n for (n,) in rows)
    return numbers


def apply_all_issues_for_order(
    db: Session, order_id: int, operator_id: int | None
) -> OrderAllIssuesSyncSummary:
    """单订单覆盖期内所有期一次排齐。只同步 ``issues`` 表里已存在的期。"""
    order = _get_order(db, order_id)  # 404 / 409(非 active)
    expected = _expected_issue_numbers_for_order(db, order)
    summary = OrderAllIssuesSyncSummary(order_id=order_id)
    if not expected:
        return summary

    existing = {
        n
        for (n,) in db.query(Issue.issue_number)
        .filter(Issue.issue_number.in_(expected))
        .all()
    }
    summary.issues_no_calendar = sorted(expected - existing)
    target_issues = sorted(existing)
    summary.issues_total = len(target_issues)

    for n in target_issues:
        preview = preview_order_shipping_sync(db, order_id, n)
        if preview.summary.conflicts:
            summary.conflict_issues.append(n)
            continue
        if preview.summary.to_create or preview.summary.to_update:
            apply_order_shipping_sync(db, order_id, n, operator_id)
            summary.rows_created += preview.summary.to_create
            summary.rows_updated += preview.summary.to_update
            summary.issues_synced += 1

    return summary


# --- 已发货回写 + 应发vs实发对账 -------------------------------------------------


def _order_generated_rows_for_issue(db: Session, issue_number: int):
    """This issue's non-orphaned order_generated shipping_details (= 应发清单)."""
    return (
        db.query(ShippingDetail)
        .filter(
            ShippingDetail.issue_number == issue_number,
            ShippingDetail.source_type == ShippingDetailSourceType.order_generated,
            ShippingDetail.sync_status != ShippingDetailSyncStatus.orphaned,
        )
        .order_by(ShippingDetail.id)
        .all()
    )


def ship_all_for_issue(
    db: Session,
    issue_number: int,
    shipped_at: Optional[date],
    operator_id: int | None,
) -> ShipBatchResult:
    """按期一键标已发：把本期已生成且未发的行标为已发（实发=计划份数）。"""
    _get_issue(db, issue_number)  # 404 if not exist
    ship_date = shipped_at or date.today()
    when = datetime.combine(ship_date, time())
    rows = [
        r
        for r in _order_generated_rows_for_issue(db, issue_number)
        if r.shipped_at is None
    ]
    for r in rows:
        r.shipped_at = when
        if r.shipped_quantity is None:
            r.shipped_quantity = r.quantity
    if rows:
        username = (
            db.query(User.username).filter(User.id == operator_id).scalar()
            if operator_id is not None
            else None
        )
        record_operation(
            db,
            user_id=operator_id,
            username=username,
            table_name="shipping_details",
            record_id=0,
            record_name=f"批量标记 {issue_number} 期已发",
            action="ship_batch",
            issue_number=issue_number,
            changes={
                "issue_number": issue_number,
                "count": len(rows),
                "shipped_at": ship_date.isoformat(),
            },
        )
    db.commit()
    return ShipBatchResult(
        issue_number=issue_number, shipped_rows=len(rows), shipped_at=ship_date
    )


def reconcile_issue(db: Session, issue_number: int) -> IssueReconciliation:
    """某期「应发 vs 实发」对账（只读）。"""
    issue = _get_issue(db, issue_number)
    rows = _order_generated_rows_for_issue(db, issue_number)

    planned_qty = 0
    shipped_qty = 0
    shipped_rows = 0
    unshipped = []
    for r in rows:
        planned_qty += r.quantity or 0
        if r.shipped_at is not None:
            shipped_rows += 1
            shipped_qty += (
                r.shipped_quantity if r.shipped_quantity is not None else (r.quantity or 0)
            )
        else:
            unshipped.append(r)

    code_map = _order_code_map(
        db, [r.order_id for r in unshipped if r.order_id is not None]
    )
    unshipped_list = [
        ReconUnshippedRow(
            order_id=r.order_id,
            order_code=code_map.get(r.order_id),
            shipping_detail_id=r.id,
            recipient_name=r.name,
            quantity=r.quantity,
        )
        for r in unshipped
    ]

    return IssueReconciliation(
        issue_number=issue_number,
        publish_date=issue.publish_date,
        planned_rows=len(rows),
        planned_quantity=planned_qty,
        shipped_rows=shipped_rows,
        shipped_quantity=shipped_qty,
        shortfall_quantity=planned_qty - shipped_qty,
        unshipped=unshipped_list,
    )
