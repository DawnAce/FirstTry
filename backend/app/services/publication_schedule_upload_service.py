from datetime import date

from sqlalchemy.orm import Session

from app.models import Issue
from app.services.publication_schedule_parser import ScheduleRowDraft


def ensure_commit_is_safe(db: Session, year: int, rows: list[ScheduleRowDraft]) -> None:
    start_date = date(year, 1, 1)
    end_date = date(year, 12, 31)
    existing_issues = (
        db.query(Issue)
        .filter(Issue.publish_date >= start_date, Issue.publish_date <= end_date)
        .all()
    )

    rows_by_issue_number = {
        row.issue_number: row
        for row in rows
        if not row.is_suspended and row.issue_number is not None
    }

    for issue in existing_issues:
        row = rows_by_issue_number.get(issue.issue_number)
        if row is None:
            raise ValueError(f"第 {issue.issue_number} 期已创建，不能从刊期表中移除")

        if row.publish_date != issue.publish_date:
            raise ValueError(
                f"第 {issue.issue_number} 期已创建，不能将出版日期从 {issue.publish_date} 改为 {row.publish_date}"
            )
