from datetime import date
import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.database import Base
from app.models import (
    Issue,
    IssueStatus,
    OperationLog,
    ShippingDetail,
    ShippingFulfillmentAdjustment,
)


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "e6a8c0d2f4b7_link_plan_stops_and_remove_zero_details.py"
    )
    spec = importlib.util.spec_from_file_location("shipping_plan_cleanup", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_removes_zero_placeholder_and_backfills_stopped_detail():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        connection.execute(text("PRAGMA ignore_check_constraints = ON"))
        issue_id = connection.execute(text("""
            INSERT INTO issues (issue_number, publish_date, status)
            VALUES (8001, '2026-08-24', 'confirmed')
        """)).lastrowid
        connection.execute(text("""
            INSERT INTO shipping_details (
                issue_number, sheet_name, channel, transport, frequency, status,
                name, quantity, shipping_requirement, source_type, sync_status
            ) VALUES (
                8001, '停发-双周（读者）', '个人订阅', '中通物流', '半月', '停发',
                '(未填写)', 0, 'tracking_required', 'historical_import', 'synced'
            )
        """))
        stopped_id = connection.execute(text("""
            INSERT INTO shipping_details (
                issue_number, sheet_name, channel, transport, frequency, status,
                name, quantity, shipping_requirement, source_type, sync_status
            ) VALUES (
                8001, '停发-双周（读者）', '个人订阅', '中通物流', '半月', '停发',
                '测试停发收件人', 1, 'no_tracking_required', 'historical_import', 'synced'
            )
        """)).lastrowid

        migration._remove_invalid_details(connection)
        migration._backfill_stopped_details(connection)

        assert connection.execute(text(
            "SELECT COUNT(*) FROM shipping_details WHERE quantity <= 0"
        )).scalar_one() == 0
        adjustment = connection.execute(text("""
            SELECT source, quantity, reason, shipping_detail_id
            FROM shipping_fulfillment_adjustments
        """)).mappings().one()
        assert adjustment["source"] == "plan_status"
        assert adjustment["quantity"] == 1
        assert adjustment["reason"] == "客户要求暂停本期发货"
        assert adjustment["shipping_detail_id"] == stopped_id
        assert connection.execute(text("""
            SELECT shipping_requirement FROM shipping_details WHERE id=:detail_id
        """), {"detail_id": stopped_id}).scalar_one() == "tracking_required"
        actions = set(connection.execute(text(
            "SELECT action FROM operation_logs WHERE issue_number=8001"
        )).scalars().all())
        assert actions == {"delete_zero_quantity_placeholder", "create_plan_stop_adjustment"}
        assert issue_id is not None


def test_model_constraint_rejects_new_zero_quantity_detail():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(Issue(
            issue_number=8002,
            publish_date=date(2026, 8, 31),
            status=IssueStatus.draft,
        ))
        db.add(ShippingDetail(
            issue_number=8002,
            sheet_name="每周（读者）",
            channel="个人订阅",
            name="零份占位",
            quantity=0,
        ))
        try:
            db.commit()
            assert False, "database constraint must reject zero-copy shipping details"
        except Exception:
            db.rollback()

        assert db.query(ShippingDetail).count() == 0
        assert db.query(ShippingFulfillmentAdjustment).count() == 0
        assert db.query(OperationLog).count() == 0


def test_migration_refuses_to_delete_linked_zero_quantity_detail():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        connection.execute(text("PRAGMA ignore_check_constraints = ON"))
        issue_id = connection.execute(text("""
            INSERT INTO issues (issue_number, publish_date, status)
            VALUES (8003, '2026-09-07', 'confirmed')
        """)).lastrowid
        detail_id = connection.execute(text("""
            INSERT INTO shipping_details (
                issue_number, sheet_name, channel, transport, frequency,
                status, name, quantity,
                shipping_requirement, source_type, sync_status
            ) VALUES (
                8003, '每周（读者）', '个人订阅', '中通物流', '周',
                '正常', '关联占位', 0,
                'tracking_required', 'historical_import', 'synced'
            )
        """)).lastrowid
        connection.execute(text("""
            INSERT INTO shipping_fulfillment_adjustments (
                issue_id, issue_number, shipping_detail_id, adjustment_type,
                source, quantity, reason
            ) VALUES (
                :issue_id, 8003, :detail_id, 'no_shipment_required',
                'manual', 1, '测试关联'
            )
        """), {"issue_id": issue_id, "detail_id": detail_id})

        with pytest.raises(RuntimeError, match="不能自动清理"):
            migration._remove_invalid_details(connection)

        assert connection.execute(text(
            "SELECT COUNT(*) FROM shipping_details WHERE id=:detail_id"
        ), {"detail_id": detail_id}).scalar_one() == 1
        assert connection.execute(text(
            "SELECT COUNT(*) FROM operation_logs WHERE issue_number=8003"
        )).scalar_one() == 0


def test_migration_refuses_to_backfill_stopped_detail_with_physical_shipment():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        connection.execute(text("""
            INSERT INTO issues (issue_number, publish_date, status)
            VALUES (8004, '2026-09-14', 'confirmed')
        """))
        connection.execute(text("""
            INSERT INTO shipping_details (
                issue_number, sheet_name, channel, transport, frequency,
                status, name, quantity,
                shipped_at, shipped_quantity, shipping_requirement,
                source_type, sync_status
            ) VALUES (
                8004, '停发-双周（读者）', '个人订阅', '中通物流', '半月',
                '停发', '冲突停发客户', 1,
                '2026-09-14 09:00:00', 1, 'tracking_required',
                'historical_import', 'synced'
            )
        """))

        with pytest.raises(RuntimeError, match="已存在实发、合寄或转库记录"):
            migration._backfill_stopped_details(connection)

        assert connection.execute(text(
            "SELECT COUNT(*) FROM shipping_fulfillment_adjustments WHERE issue_number=8004"
        )).scalar_one() == 0
