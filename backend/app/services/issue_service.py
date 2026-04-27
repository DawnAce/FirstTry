from datetime import date
from sqlalchemy.orm import Session
from sqlalchemy import desc
from app.models import PublicationSchedule, Issue, ReportEntry, ReportItemTemplate


def get_next_issue_info(db: Session) -> dict:
    """Determine the next issue number and publish date based on current date."""
    today = date.today()
    next_entry = (
        db.query(PublicationSchedule)
        .filter(PublicationSchedule.publish_date >= today, PublicationSchedule.is_suspended == False)
        .order_by(PublicationSchedule.publish_date.asc())
        .first()
    )
    if not next_entry:
        return None

    # Check if this issue already exists
    existing = db.query(Issue).filter(Issue.issue_number == next_entry.issue_number).first()
    if existing:
        # Find the one after
        next_entry = (
            db.query(PublicationSchedule)
            .filter(
                PublicationSchedule.publish_date > next_entry.publish_date,
                PublicationSchedule.is_suspended == False,
            )
            .order_by(PublicationSchedule.publish_date.asc())
            .first()
        )
        if not next_entry:
            return None

    # Find previous issue for copying data
    prev_issue = db.query(Issue).order_by(desc(Issue.issue_number)).first()

    return {
        "issue_number": next_entry.issue_number,
        "publish_date": next_entry.publish_date,
        "previous_issue_id": prev_issue.id if prev_issue else None,
    }


def create_issue_with_data(db: Session, issue_number: int, publish_date: date, notes: str = None) -> Issue:
    """Create a new issue and copy report entries from previous issue (or from templates)."""
    issue = Issue(issue_number=issue_number, publish_date=publish_date, notes=notes)
    db.add(issue)
    db.flush()  # get issue.id

    # Find previous issue
    prev_issue = (
        db.query(Issue)
        .filter(Issue.issue_number < issue_number)
        .order_by(desc(Issue.issue_number))
        .first()
    )

    if prev_issue:
        # Copy entries from previous issue
        prev_entries = db.query(ReportEntry).filter(ReportEntry.issue_id == prev_issue.id).all()
        for entry in prev_entries:
            new_entry = ReportEntry(
                issue_id=issue.id,
                category=entry.category,
                sub_category=entry.sub_category,
                value=entry.value,
                is_variable=entry.is_variable,
            )
            db.add(new_entry)
    else:
        # First issue: populate from templates
        templates = db.query(ReportItemTemplate).order_by(ReportItemTemplate.sort_order).all()
        for tmpl in templates:
            new_entry = ReportEntry(
                issue_id=issue.id,
                category=tmpl.category,
                sub_category=tmpl.sub_category,
                value=tmpl.default_value,
                is_variable=tmpl.is_variable,
            )
            db.add(new_entry)

    db.commit()
    db.refresh(issue)
    return issue
