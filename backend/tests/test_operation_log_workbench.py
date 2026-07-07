"""PR1 — 通用操作日志工作台化：record_operation 助手 + issue_number/channel/status 列
+ 缺失埋点（确认/导出）+ 跨表 /recent feed。用 sqlite 直接调函数，风格同其它后端测试。"""

import unittest
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.exports import export_report
from app.api.operation_logs import list_operation_logs, list_recent_operation_logs
from app.api.reports import confirm_report
from app.database import Base
from app.models import (
    Issue,
    IssueStatus,
    OperationLog,
    ReportEntry,
    ShippingDetail,
    User,
    UserRole,
)
from app.schemas.operation_log import ACTION_LABELS, OperationLogOut
from app.services.operation_log_service import record_operation


def _admin_user() -> User:
    return User(id=1, username="admin", role=UserRole.admin, password_hash="x")


class _SqliteTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)


class RecordOperationTests(_SqliteTestCase):
    def test_record_operation_writes_workbench_columns(self):
        db = self.SessionLocal()
        record_operation(
            db,
            user=_admin_user(),
            table_name="shipping_details",
            record_id=7,
            record_name="叶剑",
            action="create",
            issue_number=2653,
            channel="渠道订阅",
        )
        db.commit()

        log = db.query(OperationLog).one()
        self.assertEqual(log.action, "create")
        self.assertEqual(log.issue_number, 2653)
        self.assertEqual(log.channel, "渠道订阅")
        self.assertEqual(log.status, "success")
        self.assertEqual(log.user_id, 1)
        self.assertEqual(log.username, "admin")
        db.close()

    def test_record_operation_accepts_explicit_user_id(self):
        db = self.SessionLocal()
        record_operation(
            db,
            user_id=9,
            username="lisi",
            table_name="shipping_details",
            record_id=0,
            action="ship_batch",
            issue_number=2653,
        )
        db.commit()

        log = db.query(OperationLog).one()
        self.assertEqual(log.user_id, 9)
        self.assertEqual(log.username, "lisi")
        self.assertEqual(log.issue_number, 2653)
        db.close()

    def test_record_operation_does_not_commit(self):
        db = self.SessionLocal()
        record_operation(
            db,
            user=_admin_user(),
            table_name="issues",
            record_id=1,
            action="create_issue",
            issue_number=2654,
        )
        # 助手只 add 不 commit —— 回滚后应看不到任何行。
        db.rollback()
        self.assertEqual(db.query(OperationLog).count(), 0)
        db.close()


class OperationLogOutSchemaTests(_SqliteTestCase):
    def test_action_label_and_new_fields_via_model_validate(self):
        db = self.SessionLocal()
        record_operation(
            db,
            user=_admin_user(),
            table_name="reports",
            record_id=5,
            action="confirm",
            issue_number=2653,
        )
        db.commit()

        out = OperationLogOut.model_validate(db.query(OperationLog).one())
        self.assertEqual(out.action_label, ACTION_LABELS["confirm"])
        self.assertEqual(out.action_label, "确认发货明细")
        self.assertEqual(out.issue_number, 2653)
        self.assertEqual(out.status, "success")
        db.close()

    def test_unknown_action_falls_back_to_raw_key(self):
        db = self.SessionLocal()
        record_operation(
            db,
            user=_admin_user(),
            table_name="x",
            record_id=0,
            action="mystery_action",
        )
        db.commit()

        out = OperationLogOut.model_validate(db.query(OperationLog).one())
        self.assertEqual(out.action_label, "mystery_action")
        db.close()


class RecentOperationLogsEndpointTests(_SqliteTestCase):
    def _seed(self, db):
        record_operation(
            db, user=_admin_user(), table_name="shipping_details",
            record_id=1, action="create", issue_number=2653, channel="渠道订阅",
        )
        record_operation(
            db, user=_admin_user(), table_name="reports",
            record_id=2, action="confirm", issue_number=2653,
        )
        record_operation(
            db, user=_admin_user(), table_name="exports",
            record_id=3, action="export_all", issue_number=2652,
        )
        db.commit()

    def test_recent_returns_all_tables_newest_first(self):
        db = self.SessionLocal()
        self._seed(db)

        rows = list_recent_operation_logs(db=db)

        self.assertEqual(len(rows), 3)
        # created_at DESC, id DESC 兜底 —— 最后写入的 export_all(id=3) 在最前。
        self.assertEqual(rows[0].action, "export_all")
        self.assertEqual(rows[-1].action, "create")
        db.close()

    def test_recent_filters_by_issue_number(self):
        db = self.SessionLocal()
        self._seed(db)

        rows = list_recent_operation_logs(issue_number=2653, db=db)

        self.assertEqual(len(rows), 2)
        self.assertEqual({r.issue_number for r in rows}, {2653})
        db.close()

    def test_recent_filters_by_action(self):
        db = self.SessionLocal()
        self._seed(db)

        rows = list_recent_operation_logs(action="confirm", db=db)

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].action, "confirm")
        db.close()

    def test_recent_respects_limit(self):
        db = self.SessionLocal()
        self._seed(db)

        rows = list_recent_operation_logs(limit=1, db=db)

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].action, "export_all")
        db.close()

    def test_existing_per_record_endpoint_still_scopes_by_table_name(self):
        db = self.SessionLocal()
        self._seed(db)

        rows = list_operation_logs(table_name="reports", db=db)

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].action, "confirm")
        db.close()


class GapCapturePointTests(_SqliteTestCase):
    def test_confirm_report_writes_operation_log(self):
        db = self.SessionLocal()
        issue = Issue(issue_number=3101, publish_date=date(2026, 5, 25), status=IssueStatus.draft)
        db.add(issue)
        db.flush()
        db.add_all([
            ReportEntry(issue_id=issue.id, category="social_use", sub_category="营报传媒_读者", value=40),
            ShippingDetail(issue_number=3101, sheet_name="测试", channel="渠道订阅", name="甲", quantity=40),
        ])
        db.commit()

        confirm_report(issue.id, db=db, user=_admin_user())

        log = db.query(OperationLog).filter(OperationLog.action == "confirm").one()
        self.assertEqual(log.table_name, "reports")
        self.assertEqual(log.issue_number, 3101)
        self.assertEqual(log.username, "admin")
        db.close()

    def test_export_report_writes_operation_log(self):
        db = self.SessionLocal()
        issue = Issue(issue_number=3102, publish_date=date(2026, 6, 1), status=IssueStatus.confirmed)
        db.add(issue)
        db.flush()
        db.add_all([
            ReportEntry(issue_id=issue.id, category="social_use", sub_category="营报传媒_读者", value=18),
            ShippingDetail(issue_number=3102, sheet_name="测试", channel="渠道订阅", name="甲", quantity=18),
        ])
        db.commit()

        export_report(issue.id, db=db, user=_admin_user())

        log = db.query(OperationLog).filter(OperationLog.action == "export_report").one()
        self.assertEqual(log.table_name, "exports")
        self.assertEqual(log.issue_number, 3102)
        db.close()


if __name__ == "__main__":
    unittest.main()
