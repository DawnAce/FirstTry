import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Issue, IssueStatus, OperationLog, ShippingDetail, User, UserRole


_fake_cpca = SimpleNamespace(
    ad_2_addr_dict={},
    transform=MagicMock(),
)

with patch.dict("sys.modules", {"cpca": _fake_cpca}):
    from app.api.shipping_details import clear_shipping_details_by_issue


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


if __name__ == "__main__":
    unittest.main()
