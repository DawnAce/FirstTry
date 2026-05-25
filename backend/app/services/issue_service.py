from datetime import date
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
from app.models import PublicationSchedule, Issue, ReportEntry, ReportItemTemplate
from app.schemas.issue import IssueOut
from app.services.report_destination_service import resolve_report_destination


_CHINESE_DIGITS = "零一二三四五六七八九"


def format_chinese_issue_number(value: int | None) -> str | None:
    """Format 1..99 as common Chinese numerals for annual issue labels."""
    if value is None or value <= 0:
        return None
    if value < 10:
        return _CHINESE_DIGITS[value]
    if value == 10:
        return "十"
    if value < 20:
        return f"十{_CHINESE_DIGITS[value % 10]}"
    tens, ones = divmod(value, 10)
    result = f"{_CHINESE_DIGITS[tens]}十"
    if ones:
        result += _CHINESE_DIGITS[ones]
    return result


def get_year_issue_index(db: Session, issue: Issue) -> int | None:
    """Return the non-suspended publication count for issue.publish_date within its year."""
    count = (
        db.query(func.count(PublicationSchedule.id))
        .filter(
            PublicationSchedule.year == issue.publish_date.year,
            PublicationSchedule.is_suspended == False,
            PublicationSchedule.publish_date <= issue.publish_date,
        )
        .scalar()
    )
    return int(count) if count else None


def _get_planned_page_count(db: Session, issue_number: int) -> int | None:
    """Look up planned page_count from PublicationSchedule by issue_number."""
    entry = (
        db.query(PublicationSchedule.page_count)
        .filter(
            PublicationSchedule.issue_number == issue_number,
            PublicationSchedule.is_suspended == False,
        )
        .first()
    )
    return entry[0] if entry else None


def build_issue_out(db: Session, issue: Issue) -> IssueOut:
    year_issue_index = get_year_issue_index(db, issue)
    planned_page_count = _get_planned_page_count(db, issue.issue_number)
    return IssueOut(
        id=issue.id,
        issue_number=issue.issue_number,
        year_issue_index=year_issue_index,
        year_issue_label=format_chinese_issue_number(year_issue_index),
        publish_date=issue.publish_date,
        page_count=issue.page_count,
        planned_page_count=planned_page_count,
        status=issue.status,
        notes=issue.notes,
        created_at=issue.created_at,
        updated_at=issue.updated_at,
    )


def get_next_issue_info(db: Session) -> dict:
    """Suggest the next upcoming uncreated issue based on current date."""
    today = date.today()
    existing_numbers = {
        row[0] for row in db.query(Issue.issue_number).all()
    }

    # Next upcoming uncreated issue (publish_date >= today)
    next_entry = (
        db.query(PublicationSchedule)
        .filter(
            PublicationSchedule.is_suspended == False,
            PublicationSchedule.issue_number.notin_(existing_numbers) if existing_numbers else True,
            PublicationSchedule.publish_date >= today,
        )
        .order_by(PublicationSchedule.publish_date.asc())
        .first()
    )
    if not next_entry:
        return None

    prev_issue = db.query(Issue).order_by(desc(Issue.issue_number)).first()

    return {
        "issue_number": next_entry.issue_number,
        "publish_date": next_entry.publish_date,
        "page_count": next_entry.page_count,
        "previous_issue_id": prev_issue.id if prev_issue else None,
    }


def get_available_issues(db: Session) -> list[dict]:
    """Return all uncreated issues from the schedule, for user to pick from."""
    existing_numbers = {
        row[0] for row in db.query(Issue.issue_number).all()
    }

    entries = (
        db.query(PublicationSchedule)
        .filter(
            PublicationSchedule.is_suspended == False,
            PublicationSchedule.issue_number.notin_(existing_numbers) if existing_numbers else True,
        )
        .order_by(PublicationSchedule.publish_date.asc())
        .all()
    )

    return [
        {"issue_number": e.issue_number, "publish_date": e.publish_date, "page_count": e.page_count}
        for e in entries
    ]


def create_issue_with_data(db: Session, issue_number: int, publish_date: date, notes: str = None) -> Issue:
    """Create a new issue and copy report entries from previous issue (or from templates)."""
    # Auto-fill page_count from publication schedule
    scheduled_page_count = _get_planned_page_count(db, issue_number)
    initial_page_count = scheduled_page_count if scheduled_page_count else 24

    issue = Issue(issue_number=issue_number, publish_date=publish_date, page_count=initial_page_count, notes=notes)
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
                destination=resolve_report_destination(entry.category, entry.sub_category, entry.destination),
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
                destination=resolve_report_destination(tmpl.category, tmpl.sub_category, tmpl.destination),
                value=tmpl.default_value,
                is_variable=tmpl.is_variable,
            )
            db.add(new_entry)

    db.commit()
    db.refresh(issue)
    return issue
