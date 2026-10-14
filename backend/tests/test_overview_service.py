"""PR2 — ZTO-MF 跨期总览聚合服务测试。

覆盖：对账 parity（行数字 == get_report）、D2 状态优先级各分支、休刊剔除、确认后漂移、
scope(workbench 强制本年 / periods 全部年份)、KPI 计数、3 待处理提醒去重、
last_updated_at 取 operation_logs（决策③）。sqlite 直接调服务，风格同其它后端测试。
"""

import unittest
from datetime import date, datetime, timedelta
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.reports import confirm_report, get_report
from app.database import Base
from app.models import (
    Issue,
    IssueStatus,
    PublicationSchedule,
    ReportEntry,
    ShippingDetail,
    User,
    UserRole,
)
from app.services import overview_service
from app.services.operation_log_service import record_operation

TEST_YEAR = 2026
TEST_TODAY = date(TEST_YEAR, 10, 14)


def _admin() -> User:
    return User(id=1, username="admin", role=UserRole.admin, password_hash="x")


class _OverviewBase(unittest.TestCase):
    def setUp(self):
        today_patch = patch("app.services.overview_service.date", wraps=date)
        self.mock_date = today_patch.start()
        self.mock_date.today.return_value = TEST_TODAY
        self.addCleanup(today_patch.stop)
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)

    def _schedule(self, db, rows):
        """rows: [(issue_number|None, day_offset, is_suspended), ...] in TEST_YEAR."""
        base = date(TEST_YEAR, 1, 5)
        for num, off, suspended in rows:
            db.add(PublicationSchedule(
                year=TEST_YEAR,
                issue_number=num,
                publish_date=base + timedelta(days=off),
                is_suspended=suspended,
            ))
        db.commit()

    @staticmethod
    def _row(out, num):
        return next((r for r in out.rows if r.issue_number == num), None)


class StatusPrecedenceTests(_OverviewBase):
    def test_all_status_branches_and_kpi(self):
        db = self.SessionLocal()
        self._schedule(db, [
            (5001, 0, False),    # 未创建（无 issue）
            (5002, 7, False),    # 草稿
            (5003, 14, False),   # 异常（报数100 / 发货90）
            (5004, 21, False),   # 待上传（已确认、无发货）
            (5005, 28, False),   # 已上传（报数30 / 发货30）
            (None, 35, True),    # 休刊 → 剔除
        ])
        i2 = Issue(issue_number=5002, publish_date=date(TEST_YEAR, 1, 12), status=IssueStatus.draft)
        i3 = Issue(issue_number=5003, publish_date=date(TEST_YEAR, 1, 19), status=IssueStatus.confirmed)
        i4 = Issue(issue_number=5004, publish_date=date(TEST_YEAR, 1, 26), status=IssueStatus.confirmed)
        i5 = Issue(issue_number=5005, publish_date=date(TEST_YEAR, 2, 2), status=IssueStatus.confirmed)
        db.add_all([i2, i3, i4, i5])
        db.flush()
        db.add_all([
            ReportEntry(issue_id=i3.id, category="social_use", sub_category="营报传媒_读者", value=100),
            ShippingDetail(issue_number=5003, sheet_name="t", channel="渠道订阅", name="a", quantity=90),
            ReportEntry(issue_id=i4.id, category="social_use", sub_category="营报传媒_读者", value=50),
            ReportEntry(issue_id=i5.id, category="social_use", sub_category="营报传媒_读者", value=30),
            ShippingDetail(issue_number=5005, sheet_name="t", channel="渠道订阅", name="b", quantity=30),
        ])
        db.commit()

        out = overview_service.build_overview(db, scope="periods", year=TEST_YEAR)

        self.assertEqual(len(out.rows), 5)  # 休刊 excluded
        self.assertEqual(self._row(out, 5001).status, "未创建")
        self.assertEqual(self._row(out, 5001).plan_status, "未创建")
        self.assertEqual(self._row(out, 5001).waybill_status, "未开始")
        self.assertEqual(self._row(out, 5002).status, "草稿")
        self.assertEqual(self._row(out, 5002).plan_status, "草稿")
        r3 = self._row(out, 5003)
        self.assertEqual(r3.status, "异常")
        self.assertEqual(r3.plan_status, "有差异")
        self.assertEqual(r3.waybill_status, "待上传")
        self.assertEqual(r3.delta, 10)  # 报数 100 − 发货 90
        self.assertEqual(r3.exception_note, "发货份数少于报数份数")
        self.assertEqual(self._row(out, 5004).status, "待上传")
        self.assertEqual(self._row(out, 5004).plan_status, "待导入")
        self.assertEqual(self._row(out, 5005).status, "已上传")
        self.assertEqual(self._row(out, 5005).plan_status, "已就绪")
        self.assertEqual(self._row(out, 5005).waybill_status, "待上传")
        self.assertEqual(self._row(out, 5005).actual_shipped_total, 0)
        self.assertEqual(self._row(out, 5005).pending_quantity, 30)

        self.assertEqual(out.kpi.total, 5)
        self.assertEqual(out.kpi.uploaded, 1)
        self.assertEqual(out.kpi.pending, 1)
        self.assertEqual(out.kpi.uncreated, 1)
        self.assertEqual(out.kpi.exception, 1)
        self.assertEqual(out.kpi.draft, 1)
        db.close()

    def test_report_without_shipping_is_pending_not_exception(self):
        # 报数已录、发货为 0 —— 差值大但不是异常（正是截图 2654 期的情形）。
        db = self.SessionLocal()
        self._schedule(db, [(5040, 0, False)])
        issue = Issue(issue_number=5040, publish_date=date(TEST_YEAR, 1, 5), status=IssueStatus.confirmed)
        db.add(issue)
        db.flush()
        db.add(ReportEntry(issue_id=issue.id, category="social_use", sub_category="营报传媒_读者", value=1473))
        db.commit()

        row = self._row(overview_service.build_overview(db, scope="periods", year=TEST_YEAR), 5040)
        self.assertEqual(row.status, "待上传")
        self.assertEqual(row.delta, 1473)  # 报数 1473 − 发货 0
        self.assertEqual(row.exception_note, "等待上传发货明细")
        db.close()


class ParityWithGetReportTests(_OverviewBase):
    def test_overview_row_matches_get_report(self):
        db = self.SessionLocal()
        self._schedule(db, [(5010, 0, False), (5011, 7, False)])
        i10 = Issue(issue_number=5010, publish_date=date(TEST_YEAR, 1, 5), status=IssueStatus.confirmed)
        i11 = Issue(issue_number=5011, publish_date=date(TEST_YEAR, 1, 12), status=IssueStatus.confirmed)
        db.add_all([i10, i11])
        db.flush()
        db.add_all([
            ReportEntry(issue_id=i10.id, category="social_use", sub_category="营报传媒_读者", value=120),
            ReportEntry(issue_id=i10.id, category="social_use", sub_category="临时加印_自留", value=999),  # excluded
            ShippingDetail(issue_number=5010, sheet_name="t", channel="c", name="a", quantity=100),
            ReportEntry(issue_id=i11.id, category="postal", sub_category="本市", value=40),  # postal → not ZTO
            ShippingDetail(issue_number=5011, sheet_name="t", channel="c", name="b", quantity=40),
        ])
        db.commit()

        out = overview_service.build_overview(db, scope="periods", year=TEST_YEAR)
        for num, iid in [(5010, i10.id), (5011, i11.id)]:
            row = self._row(out, num)
            check = get_report(iid, db=db).shipping_check
            self.assertEqual(row.report_zt_total, check.report_zt_total, f"期{num} 报数")
            self.assertEqual(row.shipping_total, check.shipping_total, f"期{num} 发货")
            self.assertEqual(row.delta, check.delta, f"期{num} 差值")
            self.assertEqual(row.is_match, check.is_match, f"期{num} 一致")
        # 5010: 报数 120（临时加印_自留 剔除）− 发货 100 = 20
        self.assertEqual(self._row(out, 5010).report_zt_total, 120)
        # 5011: postal 不计入中通 → 报数 0
        self.assertEqual(self._row(out, 5011).report_zt_total, 0)
        db.close()


class DriftTests(_OverviewBase):
    def test_drift_marks_exception_even_when_delta_zero(self):
        db = self.SessionLocal()
        self._schedule(db, [(5020, 0, False)])
        issue = Issue(issue_number=5020, publish_date=date(TEST_YEAR, 1, 5), status=IssueStatus.draft)
        db.add(issue)
        db.flush()
        entry = ReportEntry(issue_id=issue.id, category="social_use", sub_category="营报传媒_读者", value=50)
        detail = ShippingDetail(
            issue_number=5020,
            sheet_name="t",
            channel="c",
            name="a",
            quantity=50,
            shipped_at=datetime(TEST_YEAR, 1, 5, 9, 0),
            shipped_quantity=50,
        )
        db.add_all([entry, detail])
        db.commit()

        confirm_report(issue.id, db=db, user=_admin())  # 快照 发货=50，状态→confirmed

        # 确认后同时把报数与发货抬到 60：delta 仍为 0，但发货 60 ≠ 快照 50 → 漂移。
        entry.value = 60
        detail.quantity = 60
        db.commit()

        row = self._row(overview_service.build_overview(db, scope="periods", year=TEST_YEAR), 5020)
        self.assertEqual(row.delta, 0)
        self.assertTrue(row.has_shipping_drift)
        self.assertEqual(row.status, "异常")
        self.assertEqual(row.plan_status, "有变更")
        self.assertEqual(row.waybill_status, "需核对")
        self.assertEqual(row.actual_shipped_total, 50)
        self.assertEqual(row.pending_quantity, 10)
        self.assertEqual(row.exception_note, "确认后明细已变更")
        db.close()


class ScopeTests(_OverviewBase):
    def test_workbench_forces_current_year_periods_spans_all(self):
        db = self.SessionLocal()
        cur = TEST_YEAR
        other = cur - 5
        db.add_all([
            PublicationSchedule(year=cur, issue_number=6001, publish_date=date(cur, 3, 2), is_suspended=False),
            PublicationSchedule(year=other, issue_number=6002, publish_date=date(other, 3, 2), is_suspended=False),
        ])
        db.commit()

        wb = overview_service.build_overview(db, scope="workbench")
        self.assertEqual(wb.year, cur)
        self.assertEqual({r.issue_number for r in wb.rows}, {6001})
        self.assertIsNotNone(wb.extras)

        periods = overview_service.build_overview(db, scope="periods", year=None)
        self.assertEqual({r.issue_number for r in periods.rows}, {6001, 6002})
        self.assertIsNone(periods.extras)
        db.close()


class ReminderTests(_OverviewBase):
    def test_workbench_reminders_and_dedup(self):
        db = self.SessionLocal()
        cur = TEST_YEAR
        db.add_all([
            PublicationSchedule(year=cur, issue_number=7001, publish_date=date(cur, 3, 2), is_suspended=False),
            PublicationSchedule(year=cur, issue_number=7002, publish_date=date(cur, 3, 9), is_suspended=False),
            PublicationSchedule(year=cur, issue_number=7003, publish_date=date(cur, 3, 16), is_suspended=False),
            PublicationSchedule(year=cur, issue_number=7004, publish_date=date(cur, 3, 23), is_suspended=False),
            PublicationSchedule(year=cur, issue_number=7005, publish_date=date(cur, 3, 30), is_suspended=False),
        ])
        i3 = Issue(issue_number=7003, publish_date=date(cur, 3, 16), status=IssueStatus.draft)     # 草稿
        i4 = Issue(issue_number=7004, publish_date=date(cur, 3, 23), status=IssueStatus.confirmed)  # 待上传
        i5 = Issue(issue_number=7005, publish_date=date(cur, 3, 30), status=IssueStatus.confirmed)  # 异常
        db.add_all([i3, i4, i5])
        db.flush()
        db.add_all([
            ReportEntry(issue_id=i4.id, category="social_use", sub_category="营报传媒_读者", value=10),
            ReportEntry(issue_id=i5.id, category="social_use", sub_category="营报传媒_读者", value=20),
            ShippingDetail(issue_number=7005, sheet_name="t", channel="c", name="a", quantity=15),
        ])
        db.commit()

        out = overview_service.build_overview(db, scope="workbench")
        self.assertEqual(out.kpi.pending, 1)     # 7004
        self.assertEqual(out.kpi.uncreated, 2)   # 7001, 7002
        self.assertEqual(out.kpi.draft, 1)       # 7003
        self.assertEqual(out.kpi.exception, 1)   # 7005
        rem = out.extras.reminders
        self.assertEqual(rem.no_shipping_count, 3)      # 待上传(1) + 未创建(2)（决策②）
        self.assertEqual(rem.delta_diff_count, 1)       # 仅 7005（delta=5≠0）
        self.assertEqual(rem.draft_unconfirmed_count, 1)
        db.close()


class PublishedPeriodTests(_OverviewBase):
    def _seed_boundary_periods(self, db):
        db.add_all([
            PublicationSchedule(year=2025, issue_number=9000, publish_date=date(2025, 12, 29)),
            PublicationSchedule(year=2026, issue_number=9001, publish_date=date(2026, 10, 5)),
            PublicationSchedule(year=2026, issue_number=9002, publish_date=date(2026, 10, 12)),
            PublicationSchedule(year=2026, issue_number=9003, publish_date=TEST_TODAY),
            PublicationSchedule(year=2026, issue_number=9004, publish_date=date(2026, 10, 19)),
            PublicationSchedule(year=2026, issue_number=9005, publish_date=date(2026, 10, 26)),
            PublicationSchedule(year=2027, issue_number=9006, publish_date=date(2027, 1, 4)),
            PublicationSchedule(year=2026, issue_number=9007, publish_date=date(2026, 10, 7), is_suspended=True),
            PublicationSchedule(year=2026, issue_number=None, publish_date=date(2026, 10, 8)),
        ])
        # Issue 日期故意与刊历不一致；列表的截止日必须以正式刊历为准。
        past = Issue(issue_number=9002, publish_date=date(2026, 10, 19), status=IssueStatus.confirmed)
        future = Issue(issue_number=9004, publish_date=date(2026, 10, 12), status=IssueStatus.draft)
        past.updated_at = datetime(2026, 10, 12, 10)
        future.updated_at = datetime(2026, 10, 14, 15)
        next_year = Issue(issue_number=9006, publish_date=date(2027, 1, 4), status=IssueStatus.confirmed)
        db.add_all([past, future, next_year])
        db.flush()
        db.add_all([
            ReportEntry(issue_id=past.id, category="social_use", sub_category="营报传媒_读者", value=10),
            ShippingDetail(issue_number=9002, sheet_name="test", channel="test", name="合成收件人", quantity=10),
            ShippingDetail(issue_number=9004, sheet_name="test", channel="test", name="未来合成收件人", quantity=20),
            ShippingDetail(issue_number=9006, sheet_name="test", channel="test", name="次年合成收件人", quantity=30),
        ])
        db.commit()

    def test_periods_use_calendar_cutoff_keep_past_missing_and_unshipped_plans(self):
        with self.SessionLocal() as db:
            self._seed_boundary_periods(db)
            out = overview_service.build_overview(db, scope="periods")
            self.assertEqual({r.issue_number for r in out.rows}, {9000, 9001, 9002, 9003})
            self.assertEqual(out.kpi.total, 4)
            self.assertEqual(out.kpi.uncreated, 3)
            self.assertEqual(out.kpi.draft, 0)
            self.assertEqual(out.kpi.uploaded, 1)
            self.assertEqual(self._row(out, 9001).plan_status, "未创建")
            ready = self._row(out, 9002)
            self.assertEqual(ready.publish_date, date(2026, 10, 12))
            self.assertEqual(ready.plan_status, "已就绪")
            self.assertEqual(ready.waybill_status, "待上传")
            self.assertEqual(ready.pending_quantity, 10)
            # 筛选只影响展示，不删除未来已建期数和计划。
            self.assertEqual(db.query(PublicationSchedule).count(), 9)
            self.assertEqual(db.query(ShippingDetail).count(), 3)
            future = overview_service.build_overview(db, scope="periods", year=2027)
            self.assertEqual(future.rows, [])
            self.assertEqual(future.kpi.total, 0)

    def test_workbench_excludes_future_from_counts_recent_and_reminders_but_keeps_forecast(self):
        with self.SessionLocal() as db:
            self._seed_boundary_periods(db)
            out = overview_service.build_overview(db, scope="workbench", year=2027)
            self.assertEqual(out.year, 2026)
            self.assertEqual({r.issue_number for r in out.rows}, {9001, 9002, 9003})
            self.assertEqual(out.kpi.total, 3)
            self.assertEqual(out.kpi.uncreated, 2)
            self.assertEqual(out.kpi.draft, 0)
            self.assertEqual([r.issue_number for r in out.extras.recent_issues], [9002])
            self.assertEqual([r.issue_number for r in out.extras.upcoming_issues], [9003, 9004, 9005])
            self.assertEqual(out.extras.reminders.no_shipping_count, 2)
            self.assertEqual(out.extras.reminders.delta_diff_count, 0)
            self.assertEqual(out.extras.reminders.draft_unconfirmed_count, 0)
            self.assertEqual(out.extras.latest_this_month.issue_number, 9002)

    def test_new_year_before_first_publication_has_no_current_work_and_retains_history(self):
        self.mock_date.today.return_value = date(2026, 1, 1)
        with self.SessionLocal() as db:
            db.add_all([
                PublicationSchedule(year=2025, issue_number=9100, publish_date=date(2025, 12, 29)),
                PublicationSchedule(year=2026, issue_number=9101, publish_date=date(2026, 1, 5)),
            ])
            db.commit()
            out = overview_service.build_overview(db, scope="periods")
            self.assertEqual([r.issue_number for r in out.rows], [9100])
            wb = overview_service.build_overview(db, scope="workbench")
            self.assertEqual(wb.rows, [])
            self.assertEqual(wb.kpi.total, 0)
            self.assertEqual(wb.extras.reminders.no_shipping_count, 0)
            self.assertEqual([r.issue_number for r in wb.extras.upcoming_issues], [9101])


class LastUpdatedAtTests(_OverviewBase):
    def test_last_updated_at_sourced_from_operation_log(self):
        db = self.SessionLocal()
        self._schedule(db, [(5030, 0, False), (5031, 7, False)])
        # 5030：无 issue、无发货，仅有一条 operation_log 引用它。
        record_operation(
            db, user=_admin(), table_name="shipping_details",
            record_id=0, action="create", issue_number=5030,
        )
        db.commit()

        out = overview_service.build_overview(db, scope="periods", year=TEST_YEAR)
        r30 = self._row(out, 5030)
        r31 = self._row(out, 5031)
        self.assertEqual(r30.status, "未创建")
        self.assertIsNotNone(r30.last_updated_at)  # 来自 operation_logs（决策③：任何操作）
        self.assertEqual(r31.status, "未创建")
        self.assertIsNone(r31.last_updated_at)      # 无任何时间来源
        db.close()


if __name__ == "__main__":
    unittest.main()
