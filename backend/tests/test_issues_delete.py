import unittest
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.issues import delete_issue
from app.database import Base
from app.models import (
    Issue,
    IssueStatus,
    Recipient,
    RecipientFrequency,
    RecipientType,
    ReportEntry,
    ShippingDetail,
    ShippingRecord,
    TempPrintDetail,
    User,
    UserRole,
)


class DeleteIssueTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)

    def test_admin_can_delete_issue_and_related_data(self):
        db = self.SessionLocal()
        issue = Issue(issue_number=9998, publish_date=date(2026, 12, 30), status=IssueStatus.confirmed)
        recipient = Recipient(
            name="测试收件人",
            type=RecipientType.reader,
            frequency=RecipientFrequency.weekly,
        )
        db.add_all([issue, recipient])
        db.flush()
        db.add_all(
            [
                ReportEntry(issue_id=issue.id, category="邮发", sub_category="测试", value=1),
                ShippingRecord(issue_id=issue.id, recipient_id=recipient.id, quantity=1),
                TempPrintDetail(issue_id=issue.id, department="测试", quantity=1),
                ShippingDetail(
                    issue_number=issue.issue_number,
                    sheet_name="测试",
                    channel="渠道订阅",
                    name="测试明细",
                ),
            ]
        )
        db.commit()
        issue_id = issue.id
        db.close()

        db = self.SessionLocal()
        result = delete_issue(
            issue_id,
            db=db,
            _user=User(id=1, username="admin", role=UserRole.admin, password_hash="x"),
        )

        self.assertEqual(result, {"message": "Issue deleted"})

        self.assertIsNone(db.query(Issue).filter(Issue.id == issue_id).first())
        self.assertEqual(db.query(ReportEntry).count(), 0)
        self.assertEqual(db.query(ShippingRecord).count(), 0)
        self.assertEqual(db.query(TempPrintDetail).count(), 0)
        self.assertEqual(db.query(ShippingDetail).filter(ShippingDetail.issue_number == 9998).count(), 0)
        self.assertEqual(db.query(Recipient).count(), 1)
        db.close()


if __name__ == "__main__":
    unittest.main()
