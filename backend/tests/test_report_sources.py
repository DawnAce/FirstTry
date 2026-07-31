from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.reports import confirm_report
from app.database import Base
from app.models import (
    Issue,
    IssueStatus,
    PublicationSchedule,
    ReportEntry,
    ReportSourceDocument,
    ReportSourceItem,
    User,
    UserRole,
)
from app.schemas.report_source import ReportSourceConfirmIn, ReportSourceItemConfirmIn
from app.services.issue_service import create_issue_with_data
from app.services.report_source_ocr import OcrLine, _parse_chengdu, _parse_postal
from app.services import report_source_service


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def user(db):
    result = User(username="source-test", password_hash="x", role=UserRole.admin)
    db.add(result)
    db.commit()
    db.refresh(result)
    return result


def _line(text: str, x: float, y: float, confidence: float = 0.98) -> OcrLine:
    return OcrLine(
        text=text,
        confidence=confidence,
        box=[[x, y], [x + 20, y], [x + 20, y + 10], [x, y + 10]],
    )


def _document(db, *, channel="chengdu", document_type="adjustment", suffix="1"):
    document = ReportSourceDocument(
        channel=channel,
        document_type=document_type,
        original_filename=f"source-{suffix}.jpg",
        display_name=f"来源-{suffix}.jpg",
        stored_path=f"uploads/report_sources/source-{suffix}.jpg",
        mime_type="image/jpeg",
        size=10,
        sha256=suffix.rjust(64, "0"),
        extraction_status="pending_review",
    )
    db.add(document)
    db.flush()
    return document


def _issue_with_entries(db, number=2663, status=IssueStatus.draft):
    issue = Issue(issue_number=number, publish_date=date(2026, 8, 3), status=status)
    db.add(issue)
    db.flush()
    db.add_all([
        ReportEntry(issue_id=issue.id, category="postal", sub_category="本市", value=1200),
        ReportEntry(issue_id=issue.id, category="postal", sub_category="外埠", value=5600),
        ReportEntry(issue_id=issue.id, category="chengdu", sub_category="成都杂志铺", value=363),
    ])
    db.commit()
    return issue


def test_postal_template_parser_applies_fixed_loss_split():
    lines = [
        _line("本市", 0, 0), _line("外埠", 100, 0),
        _line("损失", 200, 0), _line("合计", 300, 0),
        _line("1204", 0, 40), _line("5692", 100, 40),
        _line("20", 200, 40), _line("6916", 300, 40),
    ]

    suggestions, warnings = _parse_postal(lines)

    assert warnings == []
    assert [(row["sub_category"], row["source_quantity"], row["applied_quantity"]) for row in suggestions] == [
        ("本市", 1204, 1214),
        ("外埠", 5692, 5702),
    ]


def test_postal_handwritten_reversed_total_is_recovered_but_kept_for_review():
    lines = [
        _line("本市", 0, 0), _line("外埠", 100, 0),
        _line("损失", 200, 0), _line("合计", 300, 0),
        _line("1204", 0, 40), _line("5692", 100, 40),
        _line("20", 200, 40), _line("9169", 300, 40),
    ]

    suggestions, warnings = _parse_postal(lines)

    assert [row["applied_quantity"] for row in suggestions] == [1214, 5702]
    assert all(row["source_status"] == "pending_review" for row in suggestions)
    assert "应为 6916" in warnings[0]


def test_chengdu_cross_month_screenshot_becomes_many_adjustment_links():
    lines = [
        _line("2026年5月第3期补1份", 0, 0),
        _line("2026年6月第2期补1份", 0, 20),
        _line("2026年6月第3期补4份", 0, 40),
    ]

    document_type, suggestions, warnings = _parse_chengdu(lines, "成都杂志铺补发.jpg")

    assert document_type == "adjustment"
    assert warnings == []
    assert [row["source_period"] for row in suggestions] == ["2026-05#3", "2026-06#2", "2026-06#3"]
    assert [row["source_quantity"] for row in suggestions] == [1, 1, 4]
    assert all(row["adjustment_kind"] == "billable_addition" for row in suggestions)


def test_upload_deduplicates_same_channel_and_file(db, user, monkeypatch):
    monkeypatch.setattr(
        report_source_service,
        "recognize_report_source",
        lambda **_kwargs: {
            "document_type": "weekly",
            "source_date": date(2026, 8, 3),
            "suggestions": [],
            "warnings": [],
        },
    )
    monkeypatch.setattr(report_source_service.attachment_service, "store_file", lambda *_args: "uploads/report_sources/x.pdf")

    first, duplicate_first = report_source_service.create_source_document(
        db,
        user=user,
        channel="postal",
        filename="20260803北京报刊发行.pdf",
        content=b"same-source",
        mime_type="application/pdf",
    )
    second, duplicate_second = report_source_service.create_source_document(
        db,
        user=user,
        channel="postal",
        filename="renamed.pdf",
        content=b"same-source",
        mime_type="application/pdf",
    )

    assert duplicate_first is False
    assert duplicate_second is True
    assert second.id == first.id
    assert db.query(ReportSourceDocument).count() == 1


def test_confirmed_base_updates_draft_but_never_confirmed_issue(db, user):
    issue = _issue_with_entries(db)
    document = _document(db, channel="postal", document_type="weekly")
    db.commit()

    report_source_service.confirm_document(
        db,
        document=document,
        user=user,
        data=ReportSourceConfirmIn(items=[
            ReportSourceItemConfirmIn(
                issue_number=issue.issue_number,
                category="postal",
                sub_category="本市",
                source_quantity=1204,
                applied_quantity=1214,
            ),
            ReportSourceItemConfirmIn(
                issue_number=issue.issue_number,
                category="postal",
                sub_category="外埠",
                source_quantity=5692,
                applied_quantity=5702,
            ),
        ]),
    )
    assert db.query(ReportEntry).filter_by(issue_id=issue.id, sub_category="本市").one().value == 1214

    issue.status = IssueStatus.confirmed
    locked_value = db.query(ReportEntry).filter_by(issue_id=issue.id, sub_category="本市").one().value
    second = _document(db, channel="postal", document_type="weekly", suffix="2")
    db.commit()
    report_source_service.confirm_document(
        db,
        document=second,
        user=user,
        data=ReportSourceConfirmIn(items=[ReportSourceItemConfirmIn(
            issue_number=issue.issue_number,
            category="postal",
            sub_category="本市",
            source_quantity=9999,
            applied_quantity=9999,
        )]),
    )
    assert db.query(ReportEntry).filter_by(issue_id=issue.id, sub_category="本市").one().value == locked_value


def test_adjustments_change_settlement_and_shipping_not_print_count(db, user):
    issue = _issue_with_entries(db, status=IssueStatus.confirmed)
    document = _document(db)
    db.commit()

    confirmed = report_source_service.confirm_document(
        db,
        document=document,
        user=user,
        data=ReportSourceConfirmIn(items=[ReportSourceItemConfirmIn(
            issue_number=issue.issue_number,
            item_kind="adjustment",
            category="chengdu",
            sub_category="成都杂志铺",
            source_label="6月第3期补发",
            source_quantity=4,
            adjustment_kind="billable_addition",
        )]),
    )
    item = confirmed.items[0]
    assert item.settlement_delta == 4
    assert item.shipping_delta == 4
    assert db.query(ReportEntry).filter_by(issue_id=issue.id, category="chengdu").one().value == 363

    summary = report_source_service.get_issue_summary(db, issue)
    chengdu = next(row for row in summary.channels if row.channel == "chengdu")
    assert chengdu.base_quantity == 363
    assert chengdu.settlement_total == 367
    assert chengdu.pending_shipping == 4

    report_source_service.update_adjustment_shipping(
        db,
        item=item,
        shipped_quantity=3,
        tracking_no="SF123",
        shipped_at=None,
    )
    summary = report_source_service.get_issue_summary(db, issue)
    assert next(row for row in summary.channels if row.channel == "chengdu").pending_shipping == 1


def test_channel_pending_source_blocks_final_report_confirmation(db, user):
    issue = _issue_with_entries(db)
    document = _document(db, document_type="monthly")
    db.add(ReportSourceItem(
        document_id=document.id,
        issue_number=issue.issue_number,
        item_kind="base",
        category="chengdu",
        sub_category="成都杂志铺",
        source_label="2026年8月第1期",
        source_quantity=363,
        applied_quantity=363,
        source_status="channel_pending",
    ))
    db.commit()

    with pytest.raises(HTTPException) as exc_info:
        confirm_report(issue.id, db=db, user=user)

    assert exc_info.value.status_code == 422
    assert any(row["message"] == "渠道数据仍待确认" for row in exc_info.value.detail)
    db.refresh(issue)
    assert issue.status == IssueStatus.draft


def test_reviewed_monthly_value_applies_when_future_issue_is_created(db):
    previous = _issue_with_entries(db, number=2662)
    previous.publish_date = date(2026, 7, 27)
    future_date = date(2026, 8, 3)
    db.add(PublicationSchedule(
        year=2026,
        issue_number=2663,
        publish_date=future_date,
        is_suspended=False,
        page_count=24,
    ))
    document = _document(db, document_type="monthly")
    db.add(ReportSourceItem(
        document_id=document.id,
        issue_number=2663,
        item_kind="base",
        category="chengdu",
        sub_category="成都杂志铺",
        source_label="2026年8月第1期",
        source_quantity=377,
        applied_quantity=377,
        source_status="confirmed",
    ))
    db.commit()

    issue = create_issue_with_data(db, 2663, future_date)

    assert db.query(ReportEntry).filter_by(issue_id=issue.id, category="chengdu").one().value == 377
