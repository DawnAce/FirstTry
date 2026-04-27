from datetime import date
from sqlalchemy.orm import Session
from sqlalchemy import desc
from app.models import (
    Issue, Recipient, Subscription, ShippingRecord,
    RecipientStatus, PublicationSchedule,
)


def is_last_issue_of_month(publish_date: date, db: Session) -> bool:
    """Check if this is the last issue published in its month."""
    next_in_month = (
        db.query(PublicationSchedule)
        .filter(
            PublicationSchedule.publish_date > publish_date,
            PublicationSchedule.is_suspended == False,
        )
        .order_by(PublicationSchedule.publish_date.asc())
        .first()
    )
    if not next_in_month:
        return True
    return next_in_month.publish_date.month != publish_date.month


def should_ship_to_recipient(
    recipient: Recipient,
    issue: Issue,
    db: Session,
) -> bool:
    """Determine if a recipient should receive this issue."""
    # 1. Manual suspension overrides everything
    if recipient.status == RecipientStatus.suspended:
        return False

    # 2. Check active subscription
    latest_sub = (
        db.query(Subscription)
        .filter(
            Subscription.recipient_id == recipient.id,
            Subscription.end_date >= issue.publish_date,
            Subscription.start_date <= issue.publish_date,
        )
        .order_by(desc(Subscription.end_date))
        .first()
    )

    # For sample type, no subscription needed
    if recipient.type.value == "sample":
        pass  # always ship if active
    elif not latest_sub:
        return False

    # 3. Frequency check
    if recipient.frequency.value == "weekly":
        return True
    elif recipient.frequency.value == "biweekly":
        return issue.issue_number % 2 == 0
    elif recipient.frequency.value == "monthly":
        return is_last_issue_of_month(issue.publish_date, db)

    return True


def generate_shipping_records(issue_id: int, db: Session) -> list:
    """Generate shipping records for all eligible recipients."""
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        return []

    # Remove existing pending records (keep shipped ones)
    db.query(ShippingRecord).filter(
        ShippingRecord.issue_id == issue_id,
        ShippingRecord.status == "pending",
    ).delete()

    recipients = db.query(Recipient).all()
    records = []

    for recipient in recipients:
        if should_ship_to_recipient(recipient, issue, db):
            # Get quantity from latest subscription or default to 1
            latest_sub = (
                db.query(Subscription)
                .filter(
                    Subscription.recipient_id == recipient.id,
                    Subscription.end_date >= issue.publish_date,
                )
                .order_by(desc(Subscription.end_date))
                .first()
            )
            quantity = latest_sub.quantity if latest_sub else 1

            record = ShippingRecord(
                issue_id=issue_id,
                recipient_id=recipient.id,
                quantity=quantity,
            )
            db.add(record)
            records.append(record)

    db.commit()
    return records
