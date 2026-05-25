from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from io import BytesIO
import re
from typing import Sequence


@dataclass(frozen=True)
class ScheduleRowDraft:
    publish_date: date
    issue_number: int | None
    is_suspended: bool
    page_count: int | None = None


@dataclass(frozen=True)
class ScheduleSummary:
    total_rows: int
    published_count: int
    suspended_count: int
    first_issue_number: int | None
    last_issue_number: int | None
    page_count: int | None = None
    remarks: str | None = None


@dataclass(frozen=True)
class ParsedSchedule:
    year: int
    raw_text: str
    rows: list[ScheduleRowDraft]
    summary: ScheduleSummary
    errors: list[str]


def extract_pdf_text(content: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise ValueError("缺少 PDF 解析依赖，请先安装后端依赖后重启服务") from exc

    try:
        reader = PdfReader(BytesIO(content))
    except Exception as exc:
        raise ValueError("无法读取 PDF 文件，请确认文件未损坏") from exc

    try:
        text = "\n".join(page.extract_text() or "" for page in reader.pages).strip()
    except Exception as exc:
        raise ValueError("无法读取 PDF 文件，请确认文件未损坏") from exc

    if not text:
        raise ValueError("PDF 未包含可抽取文本，请上传文字版 PDF")

    return text


def extract_year(text: str) -> int:
    arabic_match = re.search(r"(?<!\d)(\d{4})\s*年", text)
    if arabic_match:
        return int(arabic_match.group(1))

    digit_map = {
        "零": "0",
        "〇": "0",
        "O": "0",
        "o": "0",
        "Ｏ": "0",
        "0": "0",
        "一": "1",
        "二": "2",
        "三": "3",
        "四": "4",
        "五": "5",
        "六": "6",
        "七": "7",
        "八": "8",
        "九": "9",
    }
    chinese_match = re.search(r"([零〇OoＯ0一二三四五六七八九]{4})\s*年", text)
    if chinese_match:
        return int("".join(digit_map[char] for char in chinese_match.group(1)))

    raise ValueError("无法识别出版年份")


def extract_page_count(text: str) -> int | None:
    """Extract page count from text like '对开32版' or '对开 32 版'."""
    match = re.search(r"对开\s*(\d+)\s*版", text)
    if match:
        return int(match.group(1))
    return None


def parse_schedule_pdf(content: bytes) -> ParsedSchedule:
    return parse_schedule_text(extract_pdf_text(content))


def parse_schedule_text(text: str) -> ParsedSchedule:
    year = extract_year(text)
    rows: list[ScheduleRowDraft] = []
    errors: list[str] = []
    in_table = False
    remarks: str | None = None

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        line, inline_remarks = _split_inline_remarks(line)
        if inline_remarks is not None:
            remarks = inline_remarks
            if not line:
                break
        if not in_table:
            if _is_table_header(line):
                in_table = True
            if inline_remarks is not None:
                break
            continue

        pairs = _extract_day_issue_pairs(line)
        current_month = 1
        for day, issue_text in pairs:
            try:
                publish_date, current_month = _resolve_publish_date(
                    year, current_month, day
                )
            except ValueError as exc:
                errors.append(str(exc))
                current_month += 1
                continue
            rows.append(
                ScheduleRowDraft(
                    publish_date=publish_date,
                    issue_number=None if issue_text == "休刊" else int(issue_text),
                    is_suspended=issue_text == "休刊",
                )
            )
        if inline_remarks is not None:
            break

    rows.sort(key=lambda row: row.publish_date)
    errors.extend(validate_schedule_rows(year, rows))
    if not in_table or not rows:
        errors.append("未识别到出版日期期号表")
    default_page_count = extract_page_count(text)
    rows_with_page_count = [
        ScheduleRowDraft(
            publish_date=row.publish_date,
            issue_number=row.issue_number,
            is_suspended=row.is_suspended,
            page_count=default_page_count,
        )
        for row in rows
    ]
    return ParsedSchedule(
        year=year,
        raw_text=text,
        rows=rows_with_page_count,
        summary=summarize_rows(rows_with_page_count, remarks=remarks, page_count=default_page_count),
        errors=errors,
    )


def summarize_rows(
    rows: Sequence[ScheduleRowDraft],
    remarks: str | None = None,
    page_count: int | None = None,
) -> ScheduleSummary:
    published_issue_numbers = [
        row.issue_number for row in rows if not row.is_suspended and row.issue_number is not None
    ]
    return ScheduleSummary(
        total_rows=len(rows),
        published_count=len(published_issue_numbers),
        suspended_count=sum(1 for row in rows if row.is_suspended),
        first_issue_number=min(published_issue_numbers) if published_issue_numbers else None,
        last_issue_number=max(published_issue_numbers) if published_issue_numbers else None,
        page_count=page_count,
        remarks=remarks,
    )


def validate_schedule_rows(year: int, rows: Sequence[ScheduleRowDraft]) -> list[str]:
    errors: list[str] = []
    seen_dates: set[date] = set()
    previous_issue_number: int | None = None

    for row in sorted(rows, key=lambda item: item.publish_date):
        if row.publish_date.year != year:
            errors.append(f"出版日期年份必须为 {year}：{row.publish_date.isoformat()}")

        if row.publish_date in seen_dates:
            errors.append(f"同一年内出版日期重复：{row.publish_date.isoformat()}")
        seen_dates.add(row.publish_date)

        if row.is_suspended:
            if row.issue_number is not None:
                errors.append(f"{row.publish_date.isoformat()} 是休刊行，不能填写期号")
            continue

        if row.issue_number is None or row.issue_number <= 0:
            errors.append(f"{row.publish_date.isoformat()} 必须填写正数期号")
            continue

        if previous_issue_number is not None:
            expected_issue_number = previous_issue_number + 1
            if row.issue_number != expected_issue_number:
                errors.append(
                    "期号必须连续递增："
                    f"{previous_issue_number} 后应为 {expected_issue_number}，实际为 {row.issue_number}"
                )
        previous_issue_number = row.issue_number

    return errors


def _is_table_header(line: str) -> bool:
    return line.count("日期") >= 2 and line.count("期数") >= 2


def _extract_day_issue_pairs(line: str) -> list[tuple[int, str]]:
    tokens = re.findall(r"\d+|休刊", line)
    pairs: list[tuple[int, str]] = []
    index = 0
    while index < len(tokens):
        day_text = tokens[index]
        next_token = tokens[index + 1] if index + 1 < len(tokens) else None
        if not day_text.isdigit():
            index += 1
            continue

        if next_token == "休刊":
            compact_pairs, trailing_day = _split_compact_issue_digits(day_text, allow_trailing_day=True)
            pairs.extend(compact_pairs)
            if trailing_day is not None:
                pairs.append((trailing_day, "休刊"))
            else:
                pairs.append((int(day_text), "休刊"))
            index += 2
            continue

        if next_token is not None and next_token.isdigit() and len(day_text) <= 2:
            pairs.append((int(day_text), next_token))
            index += 2
            continue

        compact_pairs, trailing_day = _split_compact_issue_digits(day_text, allow_trailing_day=False)
        pairs.extend(compact_pairs)
        if trailing_day is not None:
            pairs.append((trailing_day, ""))
        elif not compact_pairs and len(day_text) > 2:
            pairs.append((int(day_text), ""))
        index += 1
    return pairs


def _split_compact_issue_digits(
    text: str,
    allow_trailing_day: bool,
) -> tuple[list[tuple[int, str]], int | None]:
    def parse_from(position: int) -> tuple[list[tuple[int, str]], int | None] | None:
        if position == len(text):
            return [], None

        remaining = len(text) - position
        if allow_trailing_day and remaining <= 2:
            trailing_day = int(text[position:])
            if 1 <= trailing_day <= 31:
                return [], trailing_day

        for day_length in (2, 1):
            if position + day_length + 4 > len(text):
                continue
            day = int(text[position:position + day_length])
            if day < 1 or day > 31:
                continue
            issue_text = text[position + day_length:position + day_length + 4]
            issue_number = int(issue_text)
            if issue_number < 1000 or issue_number > 4999:
                continue
            result = parse_from(position + day_length + 4)
            if result is not None:
                pairs, trailing_day = result
                return [(day, issue_text), *pairs], trailing_day

        return None

    result = parse_from(0)
    return result if result is not None else ([], None)


def _split_inline_remarks(line: str) -> tuple[str, str | None]:
    if "备注" not in line:
        return line, None

    table_text, remarks = line.split("备注", 1)
    return table_text.strip(), f"备注{remarks}".strip()


def _resolve_publish_date(year: int, start_month: int, day: int) -> tuple[date, int]:
    if day < 1 or day > 31:
        raise ValueError(f"无法匹配出版日期：{year}-{day}")

    for month in range(start_month, 13):
        try:
            candidate = date(year, month, day)
        except ValueError:
            continue
        if candidate.weekday() == 0:
            return candidate, month + 1

    raise ValueError(f"无法匹配出版日期：{year}-{day}")
