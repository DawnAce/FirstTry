from io import BytesIO
from datetime import date

import pytest
from pypdf import PdfWriter

from app.services.publication_schedule_parser import (
    ScheduleRowDraft,
    extract_pdf_text,
    extract_year,
    parse_schedule_pdf,
    parse_schedule_text,
    summarize_rows,
    validate_schedule_rows,
)


SCHEDULE_2026_TEXT = """
二O二六年出版日期、期号对照表
邮发代号：1-76
报刊名称：中国经营报 出版日期：周一
第一季度 第二季度 第三季度 第四季度
1月 2月 3月 4月 5月 6月 7月 8月 9月 10月 11月 12月
日期 期数 日期 期数 日期 期数 日期 期数 日期 期数 日期 期数 日期 期数 日期 期数 日期 期数 日期 期数 日期 期数 日期 期数
5 2635 2 2639 2 2641 6 2646 4 2650 1 2654 6 2659 3 2663 7 2668 5 休刊 2 2675 7 2680
12 2636 9 2640 9 2642 13 2647 11 2651 8 2655 13 2660 10 2664 14 2669 12 2672 9 2676 14 2681
19 2637 16 休刊 16 2643 20 2648 18 2652 15 2656 20 2661 17 2665 21 2670 19 2673 16 2677 21 2682
26 2638 23 休刊 23 2644 27 2649 25 2653 22 2657 27 2662 24 2666 28 2671 26 2674 23 2678 28 2683
30 2645 29 2658 31 2667 30 2679
备注：全年出版正报49期，对开 24 版，全年定价240元
单位盖章：《中国经营报》社有限公司 日期：2025-6-18
"""


def test_extract_year_supports_chinese_zero_variant():
    assert extract_year(SCHEDULE_2026_TEXT) == 2026


def test_parse_schedule_text_extracts_2026_rows():
    parsed = parse_schedule_text(SCHEDULE_2026_TEXT)

    assert parsed.year == 2026
    assert parsed.raw_text == SCHEDULE_2026_TEXT
    assert parsed.summary.total_rows == 52
    assert parsed.summary.published_count == 49
    assert parsed.summary.suspended_count == 3
    assert parsed.summary.first_issue_number == 2635
    assert parsed.summary.last_issue_number == 2683
    assert parsed.errors == []

    suspended_dates = {row.publish_date for row in parsed.rows if row.is_suspended}
    assert suspended_dates == {
        date(2026, 2, 16),
        date(2026, 2, 23),
        date(2026, 10, 5),
    }

    published_issue_numbers = [
        row.issue_number for row in parsed.rows if not row.is_suspended
    ]
    assert published_issue_numbers == list(range(2635, 2684))


def test_parse_schedule_text_collects_unmatched_cell_errors_and_keeps_rows():
    text = """
    2026年出版日期、期号对照表
    日期 期数 日期 期数
    5 2635 99 2636
    """

    parsed = parse_schedule_text(text)

    assert [row.publish_date for row in parsed.rows] == [date(2026, 1, 5)]
    assert "无法匹配出版日期：2026-99" in parsed.errors


def test_parse_schedule_text_advances_month_after_unmatched_cell():
    text = """
    2026年出版日期、期号对照表
    日期 期数 日期 期数 日期 期数
    5 2635 99 2636 2 2637
    """

    parsed = parse_schedule_text(text)

    assert [(row.publish_date, row.issue_number) for row in parsed.rows] == [
        (date(2026, 1, 5), 2635),
        (date(2026, 3, 2), 2637),
    ]
    assert "无法匹配出版日期：2026-99" in parsed.errors


def test_parse_schedule_text_handles_inline_remarks_after_data_row():
    text = """
    2026年出版日期、期号对照表
    日期 期数 日期 期数
    30 2645 29 2658 31 2667 30 2679 备注：全年出版正报4期，对开 24 版
    """

    parsed = parse_schedule_text(text)

    assert [row.publish_date for row in parsed.rows] == [
        date(2026, 3, 30),
        date(2026, 6, 29),
        date(2026, 8, 31),
        date(2026, 11, 30),
    ]
    assert parsed.summary.remarks == "备注：全年出版正报4期，对开 24 版"
    assert "无法匹配出版日期：2026-24" not in parsed.errors


def test_parse_schedule_text_reports_missing_table():
    parsed = parse_schedule_text("2026年出版日期、期号对照表\n备注：无")

    assert parsed.rows == []
    assert parsed.errors == ["未识别到出版日期期号表"]


def test_extract_pdf_text_rejects_corrupt_pdf():
    with pytest.raises(ValueError, match="无法读取 PDF 文件，请确认文件未损坏"):
        extract_pdf_text(b"not a pdf")


def test_extract_pdf_text_rejects_pdf_without_text():
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    content = BytesIO()
    writer.write(content)

    with pytest.raises(ValueError, match="PDF 未包含可抽取文本，请上传文字版 PDF"):
        extract_pdf_text(content.getvalue())


def test_parse_schedule_pdf_parses_extracted_text(monkeypatch):
    def fake_extract_pdf_text(content: bytes) -> str:
        assert content == b"pdf bytes"
        return SCHEDULE_2026_TEXT

    monkeypatch.setattr(
        "app.services.publication_schedule_parser.extract_pdf_text",
        fake_extract_pdf_text,
    )

    parsed = parse_schedule_pdf(b"pdf bytes")

    assert parsed.year == 2026
    assert parsed.summary.published_count == 49
    assert parsed.raw_text == SCHEDULE_2026_TEXT


def test_validate_schedule_rows_rejects_out_of_year_dates():
    errors = validate_schedule_rows(
        2026,
        [
            ScheduleRowDraft(
                publish_date=date(2027, 1, 4),
                issue_number=2635,
                is_suspended=False,
            ),
        ],
    )

    assert "出版日期年份必须为 2026：2027-01-04" in errors


def test_validate_schedule_rows_rejects_missing_issue_number_on_published_row():
    errors = validate_schedule_rows(
        2026,
        [
            ScheduleRowDraft(
                publish_date=date(2026, 1, 5),
                issue_number=None,
                is_suspended=False,
            ),
        ],
    )

    assert "2026-01-05 必须填写正数期号" in errors


def test_validate_schedule_rows_rejects_non_positive_issue_number():
    errors = validate_schedule_rows(
        2026,
        [
            ScheduleRowDraft(
                publish_date=date(2026, 1, 5),
                issue_number=0,
                is_suspended=False,
            ),
        ],
    )

    assert "2026-01-05 必须填写正数期号" in errors


def test_validate_schedule_rows_rejects_suspended_row_with_issue_number():
    errors = validate_schedule_rows(
        2026,
        [
            ScheduleRowDraft(
                publish_date=date(2026, 1, 5),
                issue_number=2635,
                is_suspended=False,
            ),
            ScheduleRowDraft(
                publish_date=date(2026, 1, 12),
                issue_number=2636,
                is_suspended=True,
            ),
        ],
    )

    assert "2026-01-12 是休刊行，不能填写期号" in errors


def test_validate_schedule_rows_rejects_non_continuous_issue_numbers():
    errors = validate_schedule_rows(
        2026,
        [
            ScheduleRowDraft(
                publish_date=date(2026, 1, 5),
                issue_number=2635,
                is_suspended=False,
            ),
            ScheduleRowDraft(
                publish_date=date(2026, 1, 12),
                issue_number=2637,
                is_suspended=False,
            ),
        ],
    )

    assert "期号必须连续递增：2635 后应为 2636，实际为 2637" in errors


def test_validate_schedule_rows_rejects_duplicate_dates():
    errors = validate_schedule_rows(
        2026,
        [
            ScheduleRowDraft(
                publish_date=date(2026, 1, 5),
                issue_number=2635,
                is_suspended=False,
            ),
            ScheduleRowDraft(
                publish_date=date(2026, 1, 5),
                issue_number=2636,
                is_suspended=False,
            ),
        ],
    )

    assert "同一年内出版日期重复：2026-01-05" in errors


def test_summarize_rows_handles_empty_rows():
    summary = summarize_rows([])

    assert summary.total_rows == 0
    assert summary.published_count == 0
    assert summary.suspended_count == 0
    assert summary.first_issue_number is None
    assert summary.last_issue_number is None
