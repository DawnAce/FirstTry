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
    IssueStatus,
    OperationLog,
    ShippingDetail,
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
    from app.api.shipping_details import _snapshot, clear_shipping_details_by_issue, update_shipping_detail
from app.schemas.shipping_detail import ShippingDetailCreate, ShippingDetailOut, ShippingDetailUpdate


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


if __name__ == "__main__":
    unittest.main()
