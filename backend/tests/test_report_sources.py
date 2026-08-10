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


def test_upload_without_ocr_rows_remains_visible_on_origin_issue(db, user, monkeypatch):
    issue = _issue_with_entries(db)
    monkeypatch.setattr(
        report_source_service,
        "recognize_report_source",
        lambda **_kwargs: {
            "document_type": "weekly",
            "source_date": issue.publish_date,
            "suggestions": [],
            "warnings": ["未识别出结构化数字"],
        },
    )
    monkeypatch.setattr(
        report_source_service.attachment_service,
        "store_file",
        lambda *_args: "uploads/report_sources/unresolved.pdf",
    )

    document, _ = report_source_service.create_source_document(
        db,
        user=user,
        channel="postal",
        filename="无法识别的来源.pdf",
        content=b"unresolved-source",
        mime_type="application/pdf",
        current_issue_number=issue.issue_number,
    )

    assert document.upload_issue_number == issue.issue_number
    assert document.items == []
    summary = report_source_service.get_issue_summary(db, issue)
    assert summary.document_count == 1
    assert summary.documents[0].id == document.id
    assert summary.documents[0].upload_issue_number == issue.issue_number
    assert summary.documents[0].file_available is False

    with pytest.raises(HTTPException) as exc_info:
        confirm_report(issue.id, db=db, user=user)
    assert exc_info.value.status_code == 422
    assert any(row["message"] == "来源文件尚未识别或关联刊期" for row in exc_info.value.detail)


def test_confirmed_issue_evidence_defaults_to_archive_only(db, user, monkeypatch):
    issue = _issue_with_entries(db, status=IssueStatus.confirmed)
    monkeypatch.setattr(
        report_source_service,
        "recognize_report_source",
        lambda **_kwargs: {
            "document_type": "weekly",
            "source_date": issue.publish_date,
            "suggestions": [{
                "item_kind": "base",
                "category": "postal",
                "sub_category": "本市",
                "source_quantity": 1214,
                "applied_quantity": 1214,
                "source_status": "pending_review",
            }],
            "warnings": [],
        },
    )
    monkeypatch.setattr(report_source_service.attachment_service, "store_file", lambda *_args: "uploads/report_sources/x.pdf")

    document, _ = report_source_service.create_source_document(
        db,
        user=user,
        channel="postal",
        filename="已确认印数来源.pdf",
        content=b"archive-only-evidence",
        mime_type="application/pdf",
        current_issue_number=issue.issue_number,
        requested_document_type="adjustment",
    )

    suggestion = document.extraction_json["suggestions"][0]
    assert suggestion["item_kind"] == "adjustment"
    assert suggestion["adjustment_kind"] == "archive_only"
    assert document.items[0].source_action == "archive_only"
    assert document.items[0].adjustment_kind == "archive_only"


def test_monthly_archive_name_uses_explicit_unambiguous_filename_month():
    display_name = report_source_service._build_display_name(
        channel="chengdu",
        document_type="monthly",
        source_date=date(2026, 12, 1),
        filename="2026年1月成都杂志铺报纸报数.png",
        suggestions=[],
    )

    assert display_name == "2026年01月_成都杂志铺_月度报数.png"


def test_adjustment_archive_name_counts_distinct_issues_not_rows():
    display_name = report_source_service._build_display_name(
        channel="postal",
        document_type="adjustment",
        source_date=date(2026, 5, 4),
        filename="北京报刊发行.jpg",
        suggestions=[
            {"issue_number": 2650, "source_quantity": 1214},
            {"issue_number": 2650, "source_quantity": 5692},
        ],
    )

    assert display_name == "20260504_北京邮发_确认后凭证_1期共6906份.jpg"


@pytest.mark.parametrize(
    "suggestions",
    [
        [{"issue_number": 2650, "source_quantity": None}],
        [{"issue_number": None, "source_period": None, "source_quantity": 6906}],
        [],
    ],
)
def test_adjustment_archive_name_omits_unreliable_statistics(suggestions):
    display_name = report_source_service._build_display_name(
        channel="postal",
        document_type="adjustment",
        source_date=date(2026, 5, 4),
        filename="北京报刊发行.jpg",
        suggestions=suggestions,
    )

    assert display_name == "20260504_北京邮发_确认后凭证.jpg"


def test_duplicate_upload_refreshes_legacy_monthly_display_name(db, user):
    content = b"legacy-monthly-source"
    document = ReportSourceDocument(
        channel="chengdu",
        document_type="monthly",
        original_filename="2026年1月成都杂志铺报纸报数.png",
        display_name="202612_成都杂志铺_月度报数.png",
        stored_path="uploads/report_sources/legacy.png",
        mime_type="image/png",
        size=len(content),
        sha256=report_source_service.attachment_service.sha256_hex(content),
        source_date=date(2026, 12, 1),
        extraction_status="confirmed",
        extraction_json={"suggestions": []},
        uploaded_by=user.id,
    )
    db.add(document)
    db.commit()

    duplicate, is_duplicate = report_source_service.create_source_document(
        db,
        user=user,
        channel="chengdu",
        filename="same-file.png",
        content=content,
        mime_type="image/png",
    )

    assert is_duplicate is True
    assert duplicate.display_name == "2026年01月_成都杂志铺_月度报数.png"


def test_operator_can_withdraw_own_pending_upload(db, monkeypatch):
    operator = User(username="source-operator", password_hash="x", role=UserRole.operator)
    db.add(operator)
    db.flush()
    document = _document(db)
    document.uploaded_by = operator.id
    db.commit()
    deleted_paths = []
    monkeypatch.setattr(report_source_service.attachment_service, "delete_file", deleted_paths.append)

    report_source_service.delete_source_document(db, document=document, user=operator)

    assert db.query(ReportSourceDocument).count() == 0
    assert deleted_paths == ["uploads/report_sources/source-1.jpg"]


def test_operator_cannot_delete_confirmed_source(db):
    operator = User(username="source-operator", password_hash="x", role=UserRole.operator)
    db.add(operator)
    db.flush()
    document = _document(db)
    document.uploaded_by = operator.id
    document.extraction_status = "confirmed"
    db.commit()

    with pytest.raises(HTTPException) as exc_info:
        report_source_service.delete_source_document(db, document=document, user=operator)

    assert exc_info.value.status_code == 403
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
    with pytest.raises(HTTPException) as exc_info:
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
    assert exc_info.value.status_code == 409
    assert db.query(ReportEntry).filter_by(issue_id=issue.id, sub_category="本市").one().value == locked_value


def _confirm_chengdu_source(db, user, issue, *, quantity, suffix, action="base", supersedes=None):
    document = _document(db, channel="chengdu", document_type="monthly", suffix=suffix)
    db.commit()
    return report_source_service.confirm_document(
        db,
        document=document,
        user=user,
        data=ReportSourceConfirmIn(items=[ReportSourceItemConfirmIn(
            issue_number=issue.issue_number,
            category="chengdu",
            sub_category="成都杂志铺",
            source_quantity=quantity,
            applied_quantity=quantity,
            source_action=action,
            supersedes_item_id=supersedes,
        )]),
    )


def test_prepress_sources_add_and_replacing_base_preserves_addition(db, user):
    issue = _issue_with_entries(db)
    base = _confirm_chengdu_source(db, user, issue, quantity=350, suffix="base")
    addition = _confirm_chengdu_source(
        db, user, issue, quantity=15, suffix="addition", action="prepress_addition",
    )

    entry = db.query(ReportEntry).filter_by(issue_id=issue.id, category="chengdu").one()
    assert entry.value == 365

    replacement = _confirm_chengdu_source(
        db,
        user,
        issue,
        quantity=340,
        suffix="base-replacement",
        action="prepress_addition",  # server inherits the target's base role
        supersedes=base.items[0].id,
    )

    db.refresh(entry)
    assert entry.value == 355
    assert base.items[0].effect_status == "replaced"
    assert replacement.items[0].source_action == "base"
    assert addition.items[0].effect_status == "active"


def test_replacing_prepress_addition_changes_only_that_contribution(db, user):
    issue = _issue_with_entries(db)
    _confirm_chengdu_source(db, user, issue, quantity=350, suffix="base")
    addition = _confirm_chengdu_source(
        db, user, issue, quantity=15, suffix="addition", action="prepress_addition",
    )

    replacement = _confirm_chengdu_source(
        db,
        user,
        issue,
        quantity=20,
        suffix="addition-replacement",
        supersedes=addition.items[0].id,
    )

    entry = db.query(ReportEntry).filter_by(issue_id=issue.id, category="chengdu").one()
    assert entry.value == 370
    assert addition.items[0].effect_status == "replaced"
    assert replacement.items[0].source_action == "prepress_addition"


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


def test_archive_only_evidence_changes_no_counts(db, user):
    issue = _issue_with_entries(db, status=IssueStatus.confirmed)
    document = _document(db, channel="postal")
    document.source_date = date(2026, 8, 3)
    db.commit()

    confirmed = report_source_service.confirm_document(
        db,
        document=document,
        user=user,
        data=ReportSourceConfirmIn(items=[ReportSourceItemConfirmIn(
            issue_number=issue.issue_number,
            item_kind="adjustment",
            category="postal",
            sub_category="本市",
            source_label="已确认印数来源证明",
            source_quantity=1214,
            adjustment_kind="archive_only",
        )]),
    )

    item = confirmed.items[0]
    assert item.source_action == "archive_only"
    assert item.print_delta == 0
    assert item.settlement_delta == 0
    assert item.shipping_delta == 0
    assert confirmed.display_name == "20260803_北京邮发_确认后凭证_1期共1214份.jpg"
    assert db.query(ReportEntry).filter_by(issue_id=issue.id, sub_category="本市").one().value == 1200

    summary = report_source_service.get_issue_summary(db, issue)
    postal = next(row for row in summary.channels if row.channel == "postal")
    assert postal.base_quantity == 6800
    assert postal.settlement_total == 6800
    assert postal.pending_shipping == 0


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
        print_delta=377,
        source_status="confirmed",
    ))
    db.commit()

    issue = create_issue_with_data(db, 2663, future_date)

    assert db.query(ReportEntry).filter_by(issue_id=issue.id, category="chengdu").one().value == 377
