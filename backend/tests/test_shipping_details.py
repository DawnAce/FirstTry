import os
import sys
import unittest
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("MYSQL_USER", "test")
os.environ.setdefault("MYSQL_PASSWORD", "test")
os.environ.setdefault("MYSQL_DATABASE", "test")

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    Issue,
    IssueAuditSnapshot,
    IssueStatus,
    OperationLog,
    ShippingDetail,
    ShippingFulfillmentAdjustment,
    ShippingDetailSourceType,
    ShippingDetailSyncStatus,
    User,
    UserRole,
)


_fake_cpca = SimpleNamespace(
    ad_2_addr_dict={},
    transform=MagicMock(),
)

with patch.dict("sys.modules", {"cpca": _fake_cpca}):
    from app.api.shipping_details import (
        _copy_shipping_details_from_previous,
        _snapshot,
        batch_update_shipping_details,
        clear_shipping_details_by_issue,
        reset_actual_shipping_recipient,
        update_actual_shipping_recipient,
        update_shipping_detail,
    )
    from app.api.reports import get_report
from app.services.shipping_waybill_service import create_fulfillment_adjustment, fulfillment_summary
from app.schemas.shipping_detail import (
    ShippingDetailBatchUpdate,
    ShippingActualRecipientUpdate,
    ShippingDetailCreate,
    ShippingDetailOut,
    ShippingDetailUpdate,
)
from app.schemas.shipping_waybill import FulfillmentAdjustmentIn


class ClearShippingDetailsByIssueTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)

    def test_admin_can_clear_only_one_issue_shipping_details(self):
        db = self.SessionLocal()
        db.add_all([
            Issue(issue_number=2652, publish_date=date(2026, 5, 18), status=IssueStatus.draft),
            Issue(issue_number=2653, publish_date=date(2026, 5, 25), status=IssueStatus.draft),
            ShippingDetail(issue_number=2652, sheet_name="每周（对公）", channel="渠道订阅", name="叶剑", quantity=531),
            ShippingDetail(issue_number=2652, sheet_name="高铁展示", channel="对公订阅", name="赵叶", quantity=5),
            ShippingDetail(issue_number=2653, sheet_name="每周（对公）", channel="渠道订阅", name="叶剑", quantity=531),
        ])
        db.commit()

        result = clear_shipping_details_by_issue(
            2652,
            db=db,
            _user=User(id=1, username="admin", role=UserRole.admin, password_hash="x"),
        )

        self.assertEqual(result.affected_count, 2)
        self.assertEqual(db.query(ShippingDetail).filter(ShippingDetail.issue_number == 2652).count(), 0)
        self.assertEqual(db.query(ShippingDetail).filter(ShippingDetail.issue_number == 2653).count(), 1)

        log = db.query(OperationLog).filter(OperationLog.action == "batch_delete_issue").one()
        self.assertEqual(log.record_id, 0)
        self.assertEqual(log.record_name, "清空2652期发货明细")
        self.assertEqual(log.changes["issue_number"], 2652)
        self.assertEqual(log.changes["count"], 2)
        db.close()

    def test_clear_shipping_details_by_issue_requires_existing_issue(self):
        db = self.SessionLocal()

        with self.assertRaises(HTTPException) as ctx:
            clear_shipping_details_by_issue(
                9999,
                db=db,
                _user=User(id=1, username="admin", role=UserRole.admin, password_hash="x"),
            )

        self.assertEqual(ctx.exception.status_code, 404)
        db.close()

    def test_clear_shipping_details_by_issue_preserves_fulfillment_history(self):
        db = self.SessionLocal()
        db.add(Issue(issue_number=2652, publish_date=date(2026, 5, 18), status=IssueStatus.confirmed))
        db.add(ShippingDetail(
            issue_number=2652,
            sheet_name="每周（读者）",
            channel="个人订阅",
            name="已有实发",
            quantity=1,
            shipped_quantity=1,
        ))
        db.commit()

        with self.assertRaises(HTTPException) as ctx:
            clear_shipping_details_by_issue(
                2652,
                db=db,
                _user=User(id=1, username="admin", role=UserRole.admin, password_hash="x"),
            )

        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("已经关联运单、实发或核销记录", ctx.exception.detail)
        self.assertEqual(db.query(ShippingDetail).filter(ShippingDetail.issue_number == 2652).count(), 1)
        db.close()


class ShippingDetailsCityRemovalTests(unittest.TestCase):
    def test_shipping_detail_schemas_do_not_expose_city(self):
        for schema in (ShippingDetailCreate, ShippingDetailUpdate, ShippingDetailOut):
            self.assertNotIn("city", schema.model_fields)

    def test_operation_snapshot_does_not_track_city(self):
        detail = ShippingDetail(
            issue_number=2652,
            sheet_name="高铁展示",
            channel="对公订阅",
            name="赵叶",
            quantity=5,
        )

        self.assertNotIn("city", _snapshot(detail))

    def test_shipping_detail_schemas_reject_zero_quantity(self):
        with self.assertRaises(ValueError):
            ShippingDetailCreate(
                issue_number=2652,
                sheet_name="每周（读者）",
                channel="个人订阅",
                name="零份占位",
                quantity=0,
            )
        with self.assertRaises(ValueError):
            ShippingDetailUpdate(quantity=0)


class ShippingDetailsSyncMetadataTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)

    def test_shipping_detail_out_exposes_order_sync_metadata(self):
        detail = ShippingDetail(
            id=1,
            issue_number=2652,
            sheet_name="每周（对公）",
            channel="渠道订阅",
            transport="中通物流",
            frequency="每周",
            status="正常",
            name="叶剑",
            quantity=531,
            order_id=11,
            order_item_id=22,
            fulfillment_target_id=33,
            source_type=ShippingDetailSourceType.order_generated,
            sync_status=ShippingDetailSyncStatus.synced,
        )

        output = ShippingDetailOut.model_validate(detail)

        self.assertEqual(output.order_id, 11)
        self.assertEqual(output.order_item_id, 22)
        self.assertEqual(output.fulfillment_target_id, 33)
        self.assertEqual(output.source_type, ShippingDetailSourceType.order_generated)
        self.assertEqual(output.sync_status, ShippingDetailSyncStatus.synced)

    def test_update_order_generated_detail_marks_sync_status_manually_modified(self):
        db = self.SessionLocal()
        detail = ShippingDetail(
            issue_number=2652,
            sheet_name="每周（对公）",
            channel="渠道订阅",
            name="叶剑",
            phone="13800000000",
            quantity=531,
            source_type=ShippingDetailSourceType.order_generated,
            sync_status=ShippingDetailSyncStatus.synced,
        )
        db.add(detail)
        db.commit()
        db.refresh(detail)

        result = update_shipping_detail(
            detail.id,
            ShippingDetailUpdate(phone="13900000000"),
            db=db,
            user=User(id=1, username="admin", role=UserRole.admin, password_hash="x"),
        )

        self.assertEqual(result.sync_status, ShippingDetailSyncStatus.manually_modified)
        self.assertEqual(
            db.get(ShippingDetail, detail.id).sync_status,
            ShippingDetailSyncStatus.manually_modified,
        )
        log = db.query(OperationLog).filter(OperationLog.action == "update").one()
        self.assertIn("phone", log.changes)
        self.assertIn("sync_status", log.changes)
        db.close()

    def test_actual_recipient_adjustment_does_not_change_plan_fields(self):
        db = self.SessionLocal()
        detail = ShippingDetail(
            issue_number=2652,
            sheet_name="每周（对公）",
            channel="渠道订阅",
            name="计划收件人",
            phone="13800000000",
            address="计划地址",
            quantity=10,
            source_type=ShippingDetailSourceType.order_generated,
            sync_status=ShippingDetailSyncStatus.synced,
        )
        db.add(detail)
        db.commit()
        db.refresh(detail)

        updated = update_actual_shipping_recipient(
            detail.id,
            ShippingActualRecipientUpdate(
                name="实际收件人",
                phone="13900000000",
                reason="收件人临时调整",
            ),
            db=db,
            user=User(id=1, username="admin", role=UserRole.admin, password_hash="x"),
        )

        self.assertEqual(updated.name, "计划收件人")
        self.assertEqual(updated.phone, "13800000000")
        self.assertEqual(updated.actual_name, "实际收件人")
        self.assertEqual(updated.actual_phone, "13900000000")
        self.assertEqual(updated.sync_status, ShippingDetailSyncStatus.synced)
        self.assertEqual(
            db.query(OperationLog).filter(OperationLog.action == "update_actual_recipient").count(),
            1,
        )

        reset = reset_actual_shipping_recipient(
            detail.id,
            db=db,
            user=User(id=1, username="admin", role=UserRole.admin, password_hash="x"),
        )
        self.assertIsNone(reset.actual_name)
        self.assertEqual(reset.name, "计划收件人")
        db.close()

    def test_batch_update_order_generated_detail_marks_sync_status_manually_modified(self):
        db = self.SessionLocal()
        detail = ShippingDetail(
            issue_number=2652,
            sheet_name="每周（对公）",
            channel="渠道订阅",
            name="叶剑",
            status="正常",
            deadline="2026-05-18",
            quantity=531,
            source_type=ShippingDetailSourceType.order_generated,
            sync_status=ShippingDetailSyncStatus.synced,
        )
        db.add(detail)
        db.commit()
        db.refresh(detail)

        result = batch_update_shipping_details(
            ShippingDetailBatchUpdate(ids=[detail.id], updates={"status": "暂停"}),
            db=db,
            user=User(id=1, username="admin", role=UserRole.admin, password_hash="x"),
        )

        updated = db.get(ShippingDetail, detail.id)
        self.assertEqual(result.affected_count, 1)
        self.assertEqual(updated.status, "暂停")
        self.assertEqual(updated.sync_status, ShippingDetailSyncStatus.manually_modified)
        log = db.query(OperationLog).filter(OperationLog.action == "update").one()
        self.assertIn("status", log.changes)
        self.assertIn("sync_status", log.changes)
        db.close()

    def test_batch_update_noop_does_not_mark_sync_status_manually_modified(self):
        db = self.SessionLocal()
        detail = ShippingDetail(
            issue_number=2652,
            sheet_name="每周（对公）",
            channel="渠道订阅",
            name="叶剑",
            status="正常",
            deadline="2026-05-18",
            quantity=531,
            source_type=ShippingDetailSourceType.order_generated,
            sync_status=ShippingDetailSyncStatus.synced,
        )
        db.add(detail)
        db.commit()
        db.refresh(detail)

        result = batch_update_shipping_details(
            ShippingDetailBatchUpdate(ids=[detail.id], updates={"status": "正常"}),
            db=db,
            user=User(id=1, username="admin", role=UserRole.admin, password_hash="x"),
        )

        self.assertEqual(result.affected_count, 0)
        self.assertEqual(
            db.get(ShippingDetail, detail.id).sync_status,
            ShippingDetailSyncStatus.synced,
        )
        self.assertEqual(db.query(OperationLog).count(), 0)
        db.close()

    def test_stopped_plan_auto_links_no_shipment_and_reconciles_report(self):
        db = self.SessionLocal()
        user = User(id=1, username="admin", role=UserRole.admin, password_hash="x")
        issue = Issue(
            issue_number=2654,
            publish_date=date(2026, 6, 1),
            status=IssueStatus.confirmed,
        )
        normal = ShippingDetail(
            issue_number=2654,
            sheet_name="每周（读者）",
            channel="个人订阅",
            name="其他收件人",
            status="正常",
            quantity=1413,
        )
        stopped = ShippingDetail(
            issue_number=2654,
            sheet_name="停发-双周（读者）",
            channel="个人订阅",
            name="停发收件人",
            status="正常",
            quantity=1,
            shipping_requirement="no_tracking_required",
        )
        db.add_all([issue, normal, stopped])
        db.flush()
        db.add(IssueAuditSnapshot(
            issue_id=issue.id,
            snapshot_type="confirm",
            report_total=1414,
            shipping_total=1414,
            delta=0,
            is_match=True,
        ))
        db.commit()

        updated = update_shipping_detail(
            stopped.id,
            ShippingDetailUpdate(status="停发"),
            db=db,
            user=user,
        )

        adjustment = db.query(ShippingFulfillmentAdjustment).one()
        self.assertEqual(updated.status, "停发")
        self.assertEqual(adjustment.shipping_detail_id, stopped.id)
        self.assertEqual(adjustment.quantity, 1)
        self.assertEqual(adjustment.source, "plan_status")
        self.assertEqual(adjustment.reason, "客户要求暂停本期发货")
        self.assertEqual(updated.shipping_requirement, "tracking_required")

        report = get_report(issue.id, db=db)
        self.assertEqual(report.confirmation_summary.current_shipping_total, 1413)
        self.assertEqual(report.confirmation_summary.plan_attributed_quantity, 1)
        self.assertEqual(report.confirmation_summary.plan_unexplained_delta, 0)
        self.assertTrue(report.confirmation_summary.plan_is_reconciled)

        fulfillment = fulfillment_summary(db, issue.id)
        self.assertEqual(fulfillment.planned_quantity, 1414)
        self.assertEqual(fulfillment.actual_shipped_quantity, 0)
        self.assertEqual(fulfillment.no_shipment_quantity, 1)
        self.assertEqual(fulfillment.pending_quantity, 1413)

        with self.assertRaises(HTTPException) as duplicate_context:
            create_fulfillment_adjustment(
                db,
                issue.id,
                FulfillmentAdjustmentIn(
                    quantity=1,
                    reason="重复登记",
                    shipping_detail_id=stopped.id,
                ),
                user,
            )
        self.assertEqual(duplicate_context.exception.status_code, 400)
        self.assertIn("不能重复登记", duplicate_context.exception.detail)
        self.assertEqual(db.query(ShippingFulfillmentAdjustment).count(), 1)

        update_shipping_detail(
            stopped.id,
            ShippingDetailUpdate(status="正常"),
            db=db,
            user=user,
        )
        self.assertEqual(db.query(ShippingFulfillmentAdjustment).count(), 0)
        restored_report = get_report(issue.id, db=db)
        self.assertEqual(restored_report.confirmation_summary.current_shipping_total, 1414)
        self.assertEqual(restored_report.confirmation_summary.plan_attributed_quantity, 0)
        self.assertTrue(restored_report.confirmation_summary.plan_is_reconciled)
        db.close()

    def test_copy_from_previous_skips_order_generated_details(self):
        db = self.SessionLocal()
        db.add_all([
            Issue(issue_number=2652, publish_date=date(2026, 5, 18), status=IssueStatus.draft),
            Issue(issue_number=2653, publish_date=date(2026, 5, 25), status=IssueStatus.draft),
            ShippingDetail(
                issue_number=2652,
                sheet_name="每周（对公）",
                channel="渠道订阅",
                name="手工订阅",
                actual_name="上期临时收件人",
                quantity=10,
            ),
            ShippingDetail(
                issue_number=2652,
                sheet_name="每周（对公）",
                channel="渠道订阅",
                name="订单订阅",
                quantity=20,
                order_id=11,
                order_item_id=22,
                fulfillment_target_id=33,
                source_type=ShippingDetailSourceType.order_generated,
                sync_status=ShippingDetailSyncStatus.synced,
            ),
        ])
        db.commit()

        copied, skipped_existing = _copy_shipping_details_from_previous(
            db=db,
            issue_number=2653,
            previous_issue_number=2652,
            user=User(id=1, username="admin", role=UserRole.admin, password_hash="x"),
        )
        db.commit()

        copied_details = (
            db.query(ShippingDetail)
            .filter(ShippingDetail.issue_number == 2653)
            .order_by(ShippingDetail.id)
            .all()
        )
        self.assertFalse(skipped_existing)
        self.assertEqual(copied, 1)
        self.assertEqual(len(copied_details), 1)
        self.assertEqual(copied_details[0].name, "手工订阅")
        self.assertIsNone(copied_details[0].actual_name)
        self.assertIsNone(copied_details[0].order_id)
        self.assertIsNone(copied_details[0].order_item_id)
        self.assertIsNone(copied_details[0].fulfillment_target_id)
        self.assertNotEqual(
            copied_details[0].source_type,
            ShippingDetailSourceType.order_generated,
        )
        self.assertEqual(
            db.query(ShippingDetail)
            .filter(
                ShippingDetail.issue_number == 2653,
                ShippingDetail.source_type == ShippingDetailSourceType.order_generated,
            )
            .count(),
            0,
        )
        db.close()


if __name__ == "__main__":
    unittest.main()
