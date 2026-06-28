"""按期批量排发 + 漏期报表 + 单订单同步全部期。

真 SQLite 会话端到端跑批量逻辑（复用 order_shipping_sync_service 的单订单同步）。
"""

import os
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("MYSQL_USER", "test")
os.environ.setdefault("MYSQL_PASSWORD", "test")
os.environ.setdefault("MYSQL_DATABASE", "test")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    BillingType,
    DeliveryMethod,
    FulfillmentAllocation,
    FulfillmentTarget,
    FulfillmentType,
    Issue,
    IssueStatus,
    Order,
    OrderEntryMethod,
    OrderItem,
    OrderStatus,
    Publication,
    PublicationFormat,
    PublicationSchedule,
    ShippingChannel,
    ShippingDetail,
    ShippingDetailSyncStatus,
    SubscriptionTerm,
)
from app.services.order_shipping_batch_service import (
    apply_all_for_issue,
    apply_all_issues_for_order,
    gap_report,
    reconcile_issue,
    ship_all_for_issue,
)
from app.services.order_shipping_sync_service import apply_order_shipping_sync


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


def _seed_issue(db, issue_number, publish_date, *, is_suspended=False, with_issue_row=True):
    if with_issue_row:
        db.add(Issue(issue_number=issue_number, publish_date=publish_date, status=IssueStatus.draft))
    db.add(
        PublicationSchedule(
            year=publish_date.year,
            issue_number=None if is_suspended else issue_number,
            publish_date=publish_date,
            is_suspended=is_suspended,
        )
    )
    db.commit()


def _mk_order(
    db,
    code,
    *,
    status=OrderStatus.active,
    is_historical=False,
    channel=ShippingChannel.zto_outsource,
    coverage=(date(2026, 1, 5), date(2026, 12, 28)),
    recipient="张三",
    address="北京市朝阳区测试路 1 号",
):
    order = Order(
        order_code=code,
        order_date=date(2026, 1, 1),
        entry_method=OrderEntryMethod.excel_import,
        payer_name="P",
        status=status,
        is_historical_archive=is_historical,
        total_amount=195,
        paid_amount=195,
    )
    db.add(order)
    db.flush()
    item = OrderItem(
        order_id=order.id,
        publication=Publication.cbj,
        publication_format=PublicationFormat.paper,
        fulfillment_type=FulfillmentType.subscription,
        billing_type=BillingType.paid,
        subscription_term=SubscriptionTerm.one_year,
        delivery_method=DeliveryMethod.zto_mf,
        coverage_start_date=coverage[0],
        coverage_end_date=coverage[1],
        total_quantity=1,
        unit_price=195,
        subtotal=195,
    )
    db.add(item)
    db.flush()
    alloc = FulfillmentAllocation(
        order_item_id=item.id, version_no=1, effective_from_issue=None, effective_until_issue=None
    )
    db.add(alloc)
    db.flush()
    target = FulfillmentTarget(
        order_item_id=item.id,
        allocation_id=alloc.id,
        recipient_name=recipient,
        recipient_phone="13900000000",
        recipient_address=address,
        quantity=1,
        shipping_channel=channel,
    )
    db.add(target)
    db.commit()
    return order, item, target


# --- apply_all_for_issue ----------------------------------------------------


def test_apply_all_creates_rows_for_all_active_orders(db):
    _seed_issue(db, 2655, date(2026, 6, 1))
    _mk_order(db, "ORD-1")
    _mk_order(db, "ORD-2")

    summary = apply_all_for_issue(db, 2655, operator_id=1)

    assert summary.orders_total == 2
    assert summary.orders_applied == 2
    assert summary.rows_created == 2
    assert db.query(ShippingDetail).count() == 2


def test_apply_all_is_idempotent(db):
    _seed_issue(db, 2655, date(2026, 6, 1))
    _mk_order(db, "ORD-1")
    apply_all_for_issue(db, 2655, operator_id=1)

    summary = apply_all_for_issue(db, 2655, operator_id=1)
    assert summary.orders_applied == 0
    assert summary.orders_unchanged == 1
    assert summary.rows_created == 0
    assert db.query(ShippingDetail).count() == 1


def test_apply_all_excludes_historical_archive(db):
    _seed_issue(db, 2655, date(2026, 6, 1))
    _mk_order(db, "ORD-1")
    _mk_order(db, "ORD-H", is_historical=True)

    summary = apply_all_for_issue(db, 2655, operator_id=1)
    assert summary.orders_total == 1  # 历史归档单不纳入
    assert db.query(ShippingDetail).count() == 1


def test_apply_all_conflict_order_reported_not_aborting_batch(db):
    _seed_issue(db, 2655, date(2026, 6, 1))
    order1, _, _ = _mk_order(db, "ORD-1")
    order2, _, _ = _mk_order(db, "ORD-2")

    # order2 已同步并被人工改过 → 冲突
    apply_order_shipping_sync(db, order2.id, 2655, operator_id=1)
    conflicted = (
        db.query(ShippingDetail).filter(ShippingDetail.order_id == order2.id).one()
    )
    conflicted.sync_status = ShippingDetailSyncStatus.manually_modified
    conflicted.phone = "manual-edit"
    db.commit()

    summary = apply_all_for_issue(db, 2655, operator_id=1)

    assert summary.orders_conflict == 1
    assert summary.conflicts[0].order_code == "ORD-2"
    # order1 仍被排发（冲突单不中断整批）
    assert summary.orders_applied == 1
    assert (
        db.query(ShippingDetail).filter(ShippingDetail.order_id == order1.id).count()
        == 1
    )


def test_apply_all_suspended_issue_does_nothing(db):
    _seed_issue(db, 2655, date(2026, 6, 1), is_suspended=True)
    _mk_order(db, "ORD-1")

    summary = apply_all_for_issue(db, 2655, operator_id=1)
    assert summary.suspended is True
    assert db.query(ShippingDetail).count() == 0


def test_apply_all_aggregates_skip_reason_for_missing_coverage(db):
    _seed_issue(db, 2655, date(2026, 6, 1))
    _mk_order(db, "ORD-NOCOV", coverage=(None, None))

    summary = apply_all_for_issue(db, 2655, operator_id=1)
    assert summary.orders_skipped == 1
    assert any("覆盖期" in reason for reason in summary.skipped_reasons)
    assert db.query(ShippingDetail).count() == 0


# --- gap_report -------------------------------------------------------------


def test_gap_report_classifies_missing_and_synced(db):
    _seed_issue(db, 2655, date(2026, 6, 1))
    _mk_order(db, "ORD-MISS")
    order2, _, _ = _mk_order(db, "ORD-OK")
    apply_order_shipping_sync(db, order2.id, 2655, operator_id=1)

    report = gap_report(db, 2655)
    assert report.total_orders == 2
    assert report.synced_count == 1
    assert len(report.missing) == 1
    assert report.missing[0].order_code == "ORD-MISS"
    assert report.missing[0].recipient_name == "张三"


def test_gap_report_flags_missing_coverage_as_skipped(db):
    _seed_issue(db, 2655, date(2026, 6, 1))
    _mk_order(db, "ORD-NOCOV", coverage=(None, None))

    report = gap_report(db, 2655)
    assert len(report.missing) == 0
    assert len(report.skipped) == 1
    assert "覆盖期" in (report.skipped[0].reason or "")


def test_gap_report_suspended_issue(db):
    _seed_issue(db, 2655, date(2026, 6, 1), is_suspended=True)
    _mk_order(db, "ORD-1")

    report = gap_report(db, 2655)
    assert report.suspended is True
    assert report.total_orders == 0


# --- apply_all_issues_for_order ---------------------------------------------


def test_apply_all_issues_for_order_syncs_all_calendar_issues(db):
    _seed_issue(db, 2650, date(2026, 1, 12))
    _seed_issue(db, 2655, date(2026, 6, 1))
    order, _, _ = _mk_order(db, "ORD-1")  # coverage 2026-01-05 ~ 12-28 covers both

    summary = apply_all_issues_for_order(db, order.id, operator_id=1)
    assert summary.issues_total == 2
    assert summary.issues_synced == 2
    assert summary.rows_created == 2
    assert (
        db.query(ShippingDetail).filter(ShippingDetail.order_id == order.id).count()
        == 2
    )


def test_apply_all_issues_reports_issues_without_calendar_row(db):
    _seed_issue(db, 2655, date(2026, 6, 1))
    # 排期表有 2660、但 issues 表没有它 → 无法同步、计入 issues_no_calendar
    _seed_issue(db, 2660, date(2026, 7, 6), with_issue_row=False)
    order, _, _ = _mk_order(db, "ORD-1")

    summary = apply_all_issues_for_order(db, order.id, operator_id=1)
    assert summary.issues_total == 1  # 只有 2655 可同步
    assert summary.issues_synced == 1
    assert summary.issues_no_calendar == [2660]


# --- 已发货回写 + 对账 -------------------------------------------------------


def test_ship_all_marks_generated_rows_shipped_and_is_idempotent(db):
    _seed_issue(db, 2655, date(2026, 6, 1))
    _mk_order(db, "ORD-1")
    _mk_order(db, "ORD-2")
    apply_all_for_issue(db, 2655, operator_id=1)  # 生成 2 行

    result = ship_all_for_issue(db, 2655, shipped_at=date(2026, 6, 2), operator_id=1)
    assert result.shipped_rows == 2
    assert (
        db.query(ShippingDetail).filter(ShippingDetail.shipped_at.isnot(None)).count()
        == 2
    )
    # 实发份数默认 = 计划份数
    assert all(
        r.shipped_quantity == r.quantity
        for r in db.query(ShippingDetail).all()
    )
    # 幂等：已发的不再重标
    again = ship_all_for_issue(db, 2655, shipped_at=date(2026, 6, 2), operator_id=1)
    assert again.shipped_rows == 0


def test_reconcile_issue_planned_shipped_shortfall(db):
    _seed_issue(db, 2655, date(2026, 6, 1))
    _mk_order(db, "ORD-1")
    _mk_order(db, "ORD-2")
    apply_all_for_issue(db, 2655, operator_id=1)  # 2 行，各 1 份 → 应发 2

    # 只发其中一行
    one = db.query(ShippingDetail).order_by(ShippingDetail.id).first()
    one.shipped_at = datetime(2026, 6, 2)
    one.shipped_quantity = 1
    db.commit()

    recon = reconcile_issue(db, 2655)
    assert recon.planned_quantity == 2
    assert recon.shipped_quantity == 1
    assert recon.shortfall_quantity == 1
    assert len(recon.unshipped) == 1
    assert recon.unshipped[0].order_code in ("ORD-1", "ORD-2")
    assert recon.unshipped[0].recipient_name == "张三"


def test_reconcile_full_shipped_no_shortfall(db):
    _seed_issue(db, 2655, date(2026, 6, 1))
    _mk_order(db, "ORD-1")
    apply_all_for_issue(db, 2655, operator_id=1)
    ship_all_for_issue(db, 2655, shipped_at=date(2026, 6, 2), operator_id=1)

    recon = reconcile_issue(db, 2655)
    assert recon.planned_quantity == 1
    assert recon.shipped_quantity == 1
    assert recon.shortfall_quantity == 0
    assert recon.unshipped == []
