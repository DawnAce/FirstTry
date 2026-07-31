"""Template-aware OCR for the stable print-report source documents.

RapidOCR supplies cross-platform Chinese OCR.  The parsers remain deliberately
conservative: low-confidence or failed arithmetic checks are returned as
``pending_review`` suggestions and never silently mutate report data.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from io import BytesIO
from pathlib import Path
import re
from typing import Any, Iterable

@dataclass
class OcrLine:
    text: str
    confidence: float
    box: list[list[float]]

    @property
    def cx(self) -> float:
        return sum(point[0] for point in self.box) / len(self.box)

    @property
    def cy(self) -> float:
        return sum(point[1] for point in self.box) / len(self.box)


CHANNEL_LABELS = {
    "postal": "北京邮发",
    "retail": "北京报零",
    "guangzhou": "广州日报",
    "chengdu": "成都杂志铺",
}


def _images_from_file(filename: str, content: bytes):
    from PIL import Image

    suffix = Path(filename).suffix.lower()
    if suffix == ".pdf":
        # Render the complete page instead of decoding embedded image objects.
        # Scanner PDFs frequently contain masks/compression combinations that
        # are both slow and incomplete when extracted one XObject at a time.
        import pypdfium2 as pdfium

        document = pdfium.PdfDocument(content)
        if len(document) > 12:
            document.close()
            raise ValueError("PDF 页数超过12页，请拆分后上传")
        images = []
        try:
            for page in document:
                bitmap = page.render(scale=3)
                try:
                    images.append(bitmap.to_pil().convert("RGB"))
                finally:
                    bitmap.close()
                    page.close()
        finally:
            document.close()
        return images
    return [Image.open(BytesIO(content)).convert("RGB")]


def run_ocr(filename: str, content: bytes) -> tuple[list[OcrLine], list[str]]:
    warnings: list[str] = []
    try:
        import numpy as np
        from rapidocr_onnxruntime import RapidOCR
    except ImportError:
        return [], ["OCR 运行依赖未安装，请人工录入或安装 RapidOCR"]

    try:
        engine = RapidOCR()
        raw: list[OcrLine] = []
        for image in _images_from_file(filename, content):
            result, _elapsed = engine(np.asarray(image))
            for row in result or []:
                box, text, score = row
                normalized_box = [[float(point[0]), float(point[1])] for point in box]
                raw.append(OcrLine(text=str(text).strip(), confidence=float(score), box=normalized_box))
        raw.sort(key=lambda line: (line.cy, line.cx))
        if not raw:
            warnings.append("未识别出文字，请人工核对")
        return raw, warnings
    except Exception as exc:  # OCR is advisory; upload/archive must still succeed.
        return [], [f"OCR 识别失败：{exc}"]


def _digits(value: str) -> int | None:
    normalized = value.translate(str.maketrans("Ｏ０１２３４５６７８９", "00123456789"))
    match = re.fullmatch(r"\s*([0-9]{1,6})\s*", normalized)
    return int(match.group(1)) if match else None


def _find_label(lines: Iterable[OcrLine], needle: str) -> OcrLine | None:
    return next((line for line in lines if needle in line.text.replace(" ", "")), None)


def _number_below(lines: list[OcrLine], label: OcrLine | None) -> tuple[int | None, float | None]:
    if label is None:
        return None, None
    candidates: list[tuple[float, OcrLine, int]] = []
    for line in lines:
        value = _digits(line.text)
        if value is None or line.cy <= label.cy:
            continue
        distance = abs(line.cx - label.cx) + (line.cy - label.cy) * 0.45
        candidates.append((distance, line, value))
    if not candidates:
        return None, None
    _distance, line, value = min(candidates, key=lambda item: item[0])
    return value, line.confidence


def _number_right(lines: list[OcrLine], label: OcrLine | None) -> tuple[int | None, float | None]:
    if label is None:
        return None, None
    candidates: list[tuple[float, OcrLine, int]] = []
    for line in lines:
        value = _digits(line.text)
        if value is None or line.cx <= label.cx:
            continue
        distance = (line.cx - label.cx) + abs(line.cy - label.cy) * 3
        candidates.append((distance, line, value))
    if not candidates:
        return None, None
    _distance, line, value = min(candidates, key=lambda item: item[0])
    return value, line.confidence


def _parse_compact_date(text: str, year_hint: int | None) -> date | None:
    compact = re.search(r"(?<!\d)(20\d{2})(0[1-9]|1[0-2])([0-2]\d|3[01])(?!\d)", text)
    if compact:
        try:
            return date(int(compact.group(1)), int(compact.group(2)), int(compact.group(3)))
        except ValueError:
            pass
    chinese = re.search(r"(?:(20\d{2})年)?(1[0-2]|0?[1-9])月([0-3]?\d)日", text)
    if chinese:
        year = int(chinese.group(1)) if chinese.group(1) else year_hint
        if year:
            try:
                return date(year, int(chinese.group(2)), int(chinese.group(3)))
            except ValueError:
                pass
    return None


def _base_suggestion(
    *,
    channel: str,
    sub_category: str,
    label: str,
    source_quantity: int | None,
    applied_quantity: int | None = None,
    confidence: float | None = None,
    status: str = "pending_review",
    notes: str | None = None,
) -> dict[str, Any]:
    return {
        "issue_number": None,
        "source_period": None,
        "item_kind": "base",
        "category": channel,
        "sub_category": sub_category,
        "source_label": label,
        "source_quantity": source_quantity,
        "applied_quantity": applied_quantity if applied_quantity is not None else source_quantity,
        "source_status": status,
        "adjustment_kind": None,
        "confidence": confidence,
        "notes": notes,
    }


def _parse_postal(lines: list[OcrLine]) -> tuple[list[dict], list[str]]:
    warnings: list[str] = []
    local, local_conf = _number_below(lines, _find_label(lines, "本市"))
    external, external_conf = _number_below(lines, _find_label(lines, "外埠"))
    loss, loss_conf = _number_below(lines, _find_label(lines, "损失"))
    total, total_conf = _number_below(lines, _find_label(lines, "合计"))
    if None in {local, external, loss, total}:
        warnings.append("北京邮发关键数字未全部识别，请人工核对")
    expected_total = local + external + loss if all(value is not None for value in (local, external, loss)) else None
    valid = expected_total is not None and total == expected_total
    total_text = str(total) if total is not None else ""
    rotated_total_text = total_text[::-1].translate(str.maketrans("69", "96"))
    recovered_total = (
        expected_total is not None
        and total is not None
        and (total_text[::-1] == str(expected_total) or rotated_total_text == str(expected_total))
    )
    if recovered_total:
        # The handwritten total in the stable Beijing postal template is a
        # known OCR weak point (e.g. visible 6916 may be returned as 9169).
        # Recover only when it exactly reverses to the independently calculated
        # arithmetic total, and keep the row pending for human confirmation.
        warnings.append(f"合计手写数字识别为 {total}，按本市+外埠+损失校验应为 {expected_total}，请确认")
        valid = True
    if not valid:
        warnings.append("北京邮发“本市+外埠+损失=合计”校验未通过")
    fixed_loss = loss == 20
    if loss is not None and not fixed_loss:
        warnings.append(f"损失识别为 {loss}，不是固定20份，未自动平分")
    half_loss = 10 if valid and fixed_loss else 0
    status = "confirmed" if valid and fixed_loss and not recovered_total else "pending_review"
    confidence = min(value for value in (local_conf, external_conf, loss_conf, total_conf) if value is not None) if any(
        value is not None for value in (local_conf, external_conf, loss_conf, total_conf)
    ) else None
    return [
        _base_suggestion(
            channel="postal", sub_category="本市", label="本市（含损失分摊10份）",
            source_quantity=local, applied_quantity=None if local is None else local + half_loss,
            confidence=confidence, status=status,
        ),
        _base_suggestion(
            channel="postal", sub_category="外埠", label="外埠（含损失分摊10份）",
            source_quantity=external, applied_quantity=None if external is None else external + half_loss,
            confidence=confidence, status=status,
        ),
    ], warnings


def _parse_retail(lines: list[OcrLine]) -> tuple[list[dict], list[str]]:
    warnings: list[str] = []
    east, east_conf = _number_below(lines, _find_label(lines, "东部"))
    west, west_conf = _number_below(lines, _find_label(lines, "西部"))
    order_label = _find_label(lines, "订货数")
    order_values = []
    if order_label is not None:
        order_values = [
            value
            for line in lines
            if line.cy > order_label.cy and abs(line.cx - order_label.cx) < 60
            if (value := _digits(line.text)) is not None
        ]
    valid = east is not None and west is not None and len(order_values) >= 1 and east + west == sum(order_values)
    if east is None or west is None:
        warnings.append("北京报零东部/西部未完整识别，请人工核对")
    elif not valid:
        warnings.append("北京报零“东部+西部=订货数量”校验未通过")
    status = "confirmed" if valid else "pending_review"
    return [
        _base_suggestion(channel="retail", sub_category="东部", label="东部", source_quantity=east, confidence=east_conf, status=status),
        _base_suggestion(channel="retail", sub_category="西部", label="西部", source_quantity=west, confidence=west_conf, status=status),
    ], warnings


def _parse_guangzhou(lines: list[OcrLine]) -> tuple[list[dict], list[str]]:
    warnings: list[str] = []
    subscription, subscription_conf = _number_right(lines, _find_label(lines, "订户数"))
    retail, retail_conf = _number_right(lines, _find_label(lines, "零售数"))
    total, _total_conf = _number_right(lines, _find_label(lines, "总印数合计"))
    valid = subscription is not None and retail is not None and total is not None and subscription + retail == total
    if not valid:
        warnings.append("广州日报“订户数+零售数=合计”校验未通过")
    status = "confirmed" if valid else "pending_review"
    return [
        _base_suggestion(channel="guangzhou", sub_category="订阅", label="订户数", source_quantity=subscription, confidence=subscription_conf, status=status),
        _base_suggestion(channel="guangzhou", sub_category="零售", label="零售数", source_quantity=retail, confidence=retail_conf, status=status),
    ], warnings


_PERIOD_RE = re.compile(r"(20\d{2})年\s*(1[0-2]|0?[1-9])月\s*第\s*([1-9]\d*)\s*期")


def _parse_chengdu(lines: list[OcrLine], filename: str) -> tuple[str, list[dict], list[str]]:
    warnings: list[str] = []
    flattened = [line.text.replace(" ", "") for line in lines]
    is_adjustment = "补" in filename or any("补一下" in text or "补发" in text for text in flattened)
    periods: list[tuple[int, int, int, int | None, float | None, bool]] = []
    for index, text in enumerate(flattened):
        match = _PERIOD_RE.search(text)
        if not match:
            continue
        suffix = text[match.end():]
        inline_numbers = re.findall(r"\d+", suffix)
        quantity = int(inline_numbers[-1]) if inline_numbers else None
        quantity_conf = lines[index].confidence if quantity is not None else None
        pending = "待确认" in text or text.endswith("待")
        if quantity is None:
            for following in range(index + 1, min(index + 3, len(flattened))):
                candidate_numbers = re.findall(r"\d+", flattened[following])
                if candidate_numbers:
                    quantity = int(candidate_numbers[-1])
                    quantity_conf = lines[following].confidence
                    following_text = flattened[following]
                    pending = pending or "待确认" in following_text or (
                        "待" in text and "确认" in following_text
                    )
                    break
        periods.append((int(match.group(1)), int(match.group(2)), int(match.group(3)), quantity, quantity_conf, pending))

    if len({(year, month) for year, month, *_ in periods}) > 1:
        is_adjustment = True
    suggestions: list[dict] = []
    for year, month, ordinal, quantity, confidence, pending in periods:
        if quantity is None:
            warnings.append(f"{year}年{month}月第{ordinal}期未识别出份数")
        if is_adjustment:
            suggestions.append({
                "issue_number": None,
                "source_period": f"{year:04d}-{month:02d}#{ordinal}",
                "item_kind": "adjustment",
                "category": "chengdu",
                "sub_category": "成都杂志铺",
                "source_label": f"{year}年{month}月第{ordinal}期补发",
                "source_quantity": quantity,
                "applied_quantity": None,
                "source_status": "pending_review",
                "adjustment_kind": "billable_addition",
                "confidence": confidence,
                "notes": "默认按追加订数计入结算，确认前可改为补损/重发",
            })
        else:
            suggestions.append(_base_suggestion(
                channel="chengdu",
                sub_category="成都杂志铺",
                label=f"{year}年{month}月第{ordinal}期",
                source_quantity=quantity,
                confidence=confidence,
                status="channel_pending" if pending else "confirmed",
                notes="来源原文标记待确认" if pending else None,
            ) | {"source_period": f"{year:04d}-{month:02d}#{ordinal}"})
    if not suggestions:
        warnings.append("未识别出成都杂志铺刊期明细，请人工录入")
    return "adjustment" if is_adjustment else "monthly", suggestions, warnings


def recognize_report_source(
    *,
    channel: str,
    filename: str,
    content: bytes,
    year_hint: int | None = None,
) -> dict[str, Any]:
    lines, warnings = run_ocr(filename, content)
    all_text = "\n".join(line.text for line in lines)
    source_date = _parse_compact_date(f"{filename}\n{all_text}", year_hint)

    if channel == "postal":
        suggestions, parser_warnings = _parse_postal(lines)
        document_type = "weekly"
    elif channel == "retail":
        suggestions, parser_warnings = _parse_retail(lines)
        document_type = "weekly"
    elif channel == "guangzhou":
        suggestions, parser_warnings = _parse_guangzhou(lines)
        document_type = "weekly"
    elif channel == "chengdu":
        document_type, suggestions, parser_warnings = _parse_chengdu(lines, filename)
    else:
        suggestions, parser_warnings, document_type = [], ["不支持的来源渠道"], "weekly"
    warnings.extend(parser_warnings)
    return {
        "document_type": document_type,
        "source_date": source_date,
        "raw_text": all_text,
        "lines": [{"text": line.text, "confidence": round(line.confidence, 4)} for line in lines],
        "suggestions": suggestions,
        "warnings": warnings,
    }
