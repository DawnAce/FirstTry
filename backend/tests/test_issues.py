import unittest
from datetime import date

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.issues import delete_issue
from app.database import Base
from app.models import Issue, IssueStatus, ReportEntry, User, UserRole
from app.models.report_revision import ReportRevision


class DeleteIssueTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )

        @event.listens_for(self.engine, "connect")
        def enable_foreign_keys(dbapi_connection, _connection_record):
            dbapi_connection.execute("PRAGMA foreign_keys=ON")

        Base.metadata.create_all(bind=self.engine)
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)

    def test_delete_issue_removes_report_revisions_before_issue(self):
        db = self.SessionLocal()
        user = User(id=1, username="admin", role=UserRole.admin, password_hash="x")
        issue = Issue(issue_number=2650, publish_date=date(2026, 5, 4), status=IssueStatus.draft)
        db.add_all([user, issue])
        db.flush()
        db.add_all([
            ReportEntry(issue_id=issue.id, category="postal", sub_category="本市", value=1),
            ReportRevision(issue_id=issue.id, operator_id=user.id, reason="测试作废记录"),
        ])
        db.commit()

        result = delete_issue(issue.id, db=db, _user=user)

        self.assertEqual(result, {"message": "Issue deleted"})
        self.assertIsNone(db.query(Issue).filter(Issue.id == issue.id).first())
        self.assertEqual(db.query(ReportRevision).filter(ReportRevision.issue_id == issue.id).count(), 0)
        db.close()


if __name__ == "__main__":
    unittest.main()
