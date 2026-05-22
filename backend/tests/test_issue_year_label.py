import unittest
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.issues import get_issue
from app.cache import invalidate_dashboard_cache
from app.database import Base
from app.main import dashboard_data
from app.models import Issue, IssueStatus, PublicationSchedule


class IssueYearLabelTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)

    def test_issue_out_includes_annual_sequence_label(self):
        db = self.SessionLocal()
        schedule_rows = [
            PublicationSchedule(year=2026, issue_number=2635 + index, publish_date=date(2026, 1, 5), is_suspended=False)
            for index in range(13)
        ]
        for index, row in enumerate(schedule_rows):
            row.publish_date = date.fromordinal(date(2026, 1, 5).toordinal() + index * 7)
        schedule_rows.append(PublicationSchedule(year=2026, issue_number=2648, publish_date=date(2026, 4, 20), is_suspended=False))
        db.add_all(schedule_rows)
        issue = Issue(issue_number=2648, publish_date=date(2026, 4, 20), status=IssueStatus.draft)
        db.add(issue)
        db.commit()

        result = get_issue(issue.id, db=db)

        self.assertEqual(result.year_issue_index, 14)
        self.assertEqual(result.year_issue_label, "十四")
        db.close()

    def test_dashboard_recent_issues_include_annual_sequence_label(self):
        invalidate_dashboard_cache()
        db = self.SessionLocal()
        db.add_all(
            [
                PublicationSchedule(year=2026, issue_number=2635, publish_date=date(2026, 1, 5), is_suspended=False),
                PublicationSchedule(year=2026, issue_number=2636, publish_date=date(2026, 1, 12), is_suspended=False),
            ]
        )
        db.add(Issue(issue_number=2636, publish_date=date(2026, 1, 12), status=IssueStatus.draft))
        db.commit()

        result = dashboard_data(db=db, _user=None)

        self.assertEqual(result["recent_issues"][0]["year_issue_index"], 2)
        self.assertEqual(result["recent_issues"][0]["year_issue_label"], "二")
        db.close()


if __name__ == "__main__":
    unittest.main()
