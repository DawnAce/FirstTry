"""实际覆盖日期是履约边界；起投方式仅用于录入与回显，不回算成交价。"""
from datetime import date

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import PublicationSchedule
from app.models.order_item import Publication, FulfillmentType, OrderItem
from app.schemas.order import OrderItemIn, CoveragePreviewOut, CoverageIssueOut


def validate_start_selection(db: Session, item: OrderItemIn | OrderItem) -> None:
    if item.coverage_start_mode != "issue":
        if item.coverage_start_issue is not None:
            raise HTTPException(422, "起投期号必须与按具体刊期起订一起填写")
        return
    if item.publication != Publication.cbj or item.fulfillment_type not in {
        FulfillmentType.subscription, FulfillmentType.extension,
    }:
        raise HTTPException(422, "按具体刊期起订适用于中国经营报订阅或续订")
    if not item.coverage_start_issue or not item.coverage_start_date or not item.coverage_end_date:
        raise HTTPException(422, "请完整填写起投刊期及覆盖起止日期")
    rows = db.query(PublicationSchedule).filter(
        PublicationSchedule.issue_number == item.coverage_start_issue,
    ).populate_existing().with_for_update().all()
    if len(rows) != 1 or rows[0].is_suspended:
        raise HTTPException(422, "起投刊期不存在、重复或为休刊期，请重新选择正式刊期")
    if rows[0].publish_date != item.coverage_start_date:
        raise HTTPException(409, "起投日期与正式刊期不一致，刊期可能已调整，请刷新后重新核对")


def preview_coverage(db: Session, start: date, end: date) -> CoveragePreviewOut:
    query = db.query(PublicationSchedule).filter(
        PublicationSchedule.publish_date.between(start, end),
        PublicationSchedule.issue_number.isnot(None),
        PublicationSchedule.is_suspended.is_(False),
    )
    count = query.count()
    first = query.order_by(PublicationSchedule.publish_date).first()
    last = query.order_by(PublicationSchedule.publish_date.desc()).first()
    year_ends = dict(db.query(PublicationSchedule.year, func.max(PublicationSchedule.publish_date))
                     .filter(PublicationSchedule.year.between(start.year, end.year))
                     .group_by(PublicationSchedule.year).all())
    incomplete = any(year not in year_ends or year_ends[year].month < (end.month if year == end.year else 12)
                     for year in range(start.year, end.year + 1))
    def issue(row: PublicationSchedule) -> CoverageIssueOut:
        return CoverageIssueOut(issue_number=row.issue_number, publish_date=row.publish_date)
    return CoveragePreviewOut(first_issue=issue(first) if first else None,
                              last_issue=issue(last) if last else None,
                              expected_issue_count=count, schedule_incomplete=incomplete)
