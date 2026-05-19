import asyncio
import io
import unittest
from datetime import date

from openpyxl import load_workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.exports import export_shipping
from app.api.reports import confirm_report, get_report
from app.database import Base
from app.models import Issue, IssueStatus, ReportEntry, ShippingDetail, User, UserRole


class ReportShippingChainTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)

    def _read_streaming_response_bytes(self, response) -> bytes:
        async def _collect_body() -> bytes:
            chunks = []
            async for chunk in response.body_iterator:
                chunks.append(chunk)
            return b"".join(chunks)

        return asyncio.run(_collect_body())

    def test_confirm_uses_shipping_details_total_and_persists_snapshot(self):
        db = self.SessionLocal()
        issue = Issue(issue_number=3001, publish_date=date(2026, 5, 25), status=IssueStatus.draft)
        db.add(issue)
        db.flush()
        db.add_all(
            [
                ReportEntry(issue_id=issue.id, category="postal", sub_category="本市", value=10),
                ReportEntry(issue_id=issue.id, category="social_use", sub_category="营报传媒_读者", value=40),
                ShippingDetail(issue_number=3001, sheet_name="测试", channel="渠道订阅", name="甲", quantity=15),
                ShippingDetail(issue_number=3001, sheet_name="测试", channel="渠道订阅", name="乙", quantity=25),
            ]
        )
        db.commit()

        # Step 1: Confirm the report with shipping_total = 40
        result = confirm_report(
            issue.id,
            db=db,
            user=User(id=1, username="admin", role=UserRole.admin, password_hash="x"),
        )

        self.assertEqual(result["zt_report_total"], 40)
        self.assertEqual(result["zt_shipping_total"], 40)

        # Step 2: Mutate shipping_details after confirmation
        shipping_details = db.query(ShippingDetail).filter_by(issue_number=3001).all()
        shipping_details[0].quantity = 100  # Change 甲 from 15 to 100
        db.commit()

        # Step 3: Get report and verify confirmation_summary still shows confirmed totals
        report = get_report(issue.id, db=db)
        self.assertEqual(report.confirmation_summary.shipping_total, 40)  # Persisted snapshot
        self.assertEqual(report.confirmation_summary.is_match, True)
        # TODO: Later task will add current_shipping_total field showing 125 (100 + 25)

    def test_shipping_export_reads_shipping_details_instead_of_shipping_records(self):
        db = self.SessionLocal()
        issue = Issue(issue_number=3002, publish_date=date(2026, 6, 1), status=IssueStatus.confirmed)
        db.add(issue)
        db.flush()
        db.add_all(
            [
                ShippingDetail(issue_number=3002, sheet_name="测试", channel="渠道订阅", name="甲", quantity=7),
                ShippingDetail(issue_number=3002, sheet_name="测试", channel="对公订阅", name="乙", quantity=9),
            ]
        )
        db.commit()

        response = export_shipping(issue.id, db=db)

        self.assertIn(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            response.media_type,
        )
        workbook = load_workbook(io.BytesIO(self._read_streaming_response_bytes(response)))
        summary_sheet = workbook["每周合计"]
        self.assertEqual(summary_sheet["B2"].value, "甲")
        self.assertEqual(summary_sheet["E2"].value, 7)
        self.assertEqual(summary_sheet["B3"].value, "乙")
        self.assertEqual(summary_sheet["E3"].value, 9)

    def test_confirm_mismatch_is_saved_for_future_drift_display(self):
        db = self.SessionLocal()
        issue = Issue(issue_number=3003, publish_date=date(2026, 6, 8), status=IssueStatus.draft)
        db.add(issue)
        db.flush()
        db.add_all(
            [
                ReportEntry(issue_id=issue.id, category="social_use", sub_category="营报传媒_读者", value=30),
                ShippingDetail(issue_number=3003, sheet_name="测试", channel="渠道订阅", name="甲", quantity=18),
            ]
        )
        db.commit()

        # Step 1: Confirm the report with mismatch (report=30, shipping=18, delta=12)
        result = confirm_report(
            issue.id,
            db=db,
            user=User(id=1, username="admin", role=UserRole.admin, password_hash="x"),
        )

        self.assertIn("warning", result)

        # Step 2: Mutate shipping_details after confirmation
        shipping_detail = db.query(ShippingDetail).filter_by(issue_number=3003).first()
        shipping_detail.quantity = 50  # Change from 18 to 50
        db.commit()

        # Step 3: Get report and verify confirmation_summary still shows confirmed delta
        report = get_report(issue.id, db=db)
        self.assertEqual(report.confirmation_summary.delta, 12)  # Persisted: 30 - 18
        self.assertEqual(report.confirmation_summary.is_match, False)
        self.assertEqual(report.confirmation_summary.shipping_total, 18)  # Persisted snapshot
        # TODO: Later task will add current_shipping_total field showing 50


if __name__ == "__main__":
    unittest.main()
