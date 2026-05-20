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
from app.models import Issue, IssueAuditSnapshot, IssueStatus, ReportEntry, ShippingDetail, User, UserRole


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

    def test_issue_audit_snapshot_model_is_wired_to_issue(self):
        from app.models import IssueAuditSnapshot

        self.assertEqual(IssueAuditSnapshot.__tablename__, "issue_audit_snapshots")
        self.assertTrue(hasattr(Issue, "audit_snapshots"))

    def test_confirm_uses_shipping_details_total_and_returns_snapshot_and_drift_totals(self):
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

        # Step 3: Get report and verify confirmation_summary separates confirmed snapshot totals
        # from current drift totals after the live rows have changed.
        report = get_report(issue.id, db=db)
        self.assertEqual(report.confirmation_summary.confirmed_report_total, 40)
        self.assertEqual(report.confirmation_summary.confirmed_shipping_total, 40)
        self.assertEqual(report.confirmation_summary.confirmed_delta, 0)
        self.assertEqual(report.confirmation_summary.confirmed_is_match, True)
        self.assertEqual(report.confirmation_summary.current_shipping_total, 125)
        self.assertEqual(report.confirmation_summary.current_delta, -85)
        self.assertEqual(report.confirmation_summary.current_is_match, False)
        self.assertEqual(report.confirmation_summary.has_shipping_drift, True)

    def test_confirm_report_persists_issue_audit_snapshot_row(self):
        db = self.SessionLocal()
        issue = Issue(issue_number=3010, publish_date=date(2026, 7, 20), status=IssueStatus.draft)
        db.add(issue)
        db.flush()
        db.add_all(
            [
                ReportEntry(issue_id=issue.id, category="social_use", sub_category="营报传媒_读者", value=22),
                ShippingDetail(issue_number=3010, sheet_name="测试", channel="渠道订阅", name="甲", quantity=10),
            ]
        )
        db.commit()

        result = confirm_report(
            issue.id,
            db=db,
            user=User(id=1, username="admin", role=UserRole.admin, password_hash="x"),
        )

        self.assertIn("warning", result)
        snapshot = db.query(IssueAuditSnapshot).filter_by(issue_id=issue.id, snapshot_type="confirm").one()
        self.assertEqual(snapshot.report_total, 22)
        self.assertEqual(snapshot.shipping_total, 10)
        self.assertEqual(snapshot.delta, 12)
        self.assertEqual(snapshot.is_match, False)

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
        exported_rows = {
            (summary_sheet[f"B{row}"].value, summary_sheet[f"E{row}"].value)
            for row in range(2, 10)
            if summary_sheet[f"B{row}"].value
        }
        self.assertIn(("甲", 7), exported_rows)
        self.assertIn(("乙", 9), exported_rows)

    def test_shipping_export_persists_export_audit_snapshot(self):
        db = self.SessionLocal()
        issue = Issue(issue_number=3004, publish_date=date(2026, 6, 15), status=IssueStatus.confirmed)
        db.add(issue)
        db.flush()
        db.add_all(
            [
                ReportEntry(issue_id=issue.id, category="social_use", sub_category="营报传媒_读者", value=30),
                ShippingDetail(issue_number=3004, sheet_name="测试", channel="渠道订阅", name="甲", quantity=12),
                ShippingDetail(issue_number=3004, sheet_name="测试", channel="对公订阅", name="乙", quantity=8),
            ]
        )
        db.commit()

        response = export_shipping(issue.id, db=db)

        self.assertIn(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            response.media_type,
        )
        snapshot = (
            db.query(IssueAuditSnapshot)
            .filter_by(issue_id=issue.id, snapshot_type="shipping_export")
            .one()
        )
        self.assertEqual(snapshot.report_total, 30)
        self.assertEqual(snapshot.shipping_total, 20)
        self.assertEqual(snapshot.delta, 10)
        self.assertEqual(snapshot.is_match, False)

    def test_confirm_mismatch_returns_snapshot_and_current_drift_values(self):
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

        # Step 3: Get report and verify confirmation_summary keeps the confirmed snapshot
        # while also surfacing the current live totals after drift.
        report = get_report(issue.id, db=db)
        self.assertEqual(report.confirmation_summary.confirmed_report_total, 30)
        self.assertEqual(report.confirmation_summary.confirmed_shipping_total, 18)
        self.assertEqual(report.confirmation_summary.confirmed_delta, 12)
        self.assertEqual(report.confirmation_summary.confirmed_is_match, False)
        self.assertEqual(report.confirmation_summary.current_shipping_total, 50)
        self.assertEqual(report.confirmation_summary.current_delta, -20)
        self.assertEqual(report.confirmation_summary.current_is_match, False)
        self.assertEqual(report.confirmation_summary.has_shipping_drift, True)


if __name__ == "__main__":
    unittest.main()
