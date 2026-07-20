"""邮局订报数据生成模块 · 来源文件解析（来源A 订阅明细 / 来源B 读者统计）。

**按表头名识别、不靠文件名**（文档 §5）。表头映射做成可配置常量 ——
样本到位后在 ``SOURCE_A_HEADERS`` / ``SOURCE_B_HEADERS`` 锁定精确列名即可，
其余流水线（校验 / 计算 / 生成）不受影响。

来源A（.xls/.xlsx 订阅明细）→ 逐行 ``ParsedRow``（主明细）。
来源B（.xlsx/.csv 读者统计）→ 汇总口径，用于与来源A 对账。CSV **必须识别 UTF-8 BOM**，
其它编码无法可靠判断则拒绝处理（返回阻断问题）。
"""

import csv
import io
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from openpyxl import load_workbook


# --- 可配置表头映射（样本到位后锁定） --------------------------------------
# field -> 可接受的表头名（按优先级）。识别时大小写/首尾空白已归一。
SOURCE_A_HEADERS: Dict[str, List[str]] = {
    "name": ["姓名", "收报人", "订户姓名", "客户姓名"],
    "phone": ["电话", "联系电话", "手机", "手机号"],
    "address": ["地址", "详细地址", "收货地址", "通讯地址"],
    "province": ["省", "省份"],
    "city": ["市", "城市", "地市"],
    "district": ["区", "区县", "县区"],
    "postal_code": ["邮编", "邮政编码"],
    "copies": ["份数", "订阅份数", "数量"],
    "months": ["月数", "订阅月数", "订期", "订阅期限"],
    "region": ["地区", "投递地区", "所属地区"],
    "distribution_unit": ["投递单位", "集订分送", "分送单位"],
}
# 来源A 必备列（缺失则阻断，不猜）。
SOURCE_A_REQUIRED = ["name", "address"]

SOURCE_B_HEADERS: Dict[str, List[str]] = {
    "region": ["地区", "省份", "省", "所属地区"],
    "count": ["条数", "订户数", "记录数", "户数"],
    "copies": ["份数", "订阅份数", "数量"],
}


@dataclass
class ParsedRow:
    source_file_role: str
    source_row: int
    name: str = ""
    phone: str = ""
    province: str = ""
    city: str = ""
    district: str = ""
    address: str = ""
    postal_code: str = ""
    copies: Optional[int] = None
    months: Optional[int] = None
    region: str = ""
    distribution_unit: str = ""
    excluded: bool = False
    exclude_reason: str = ""
    raw: dict = field(default_factory=dict)


@dataclass
class ParseIssue:
    level: str          # block | warn | info
    source: str         # A | B
    sheet_or_file: str = ""
    row_no: Optional[int] = None
    field_name: str = ""
    code: str = ""
    message: str = ""


@dataclass
class ParseResult:
    rows: List[ParsedRow] = field(default_factory=list)
    issues: List[ParseIssue] = field(default_factory=list)
    # 来源B 汇总（对账用）：{"total_count": n, "total_copies": n, "by_region": {...}}
    summary_b: dict = field(default_factory=dict)


def _norm_header(v) -> str:
    return str(v).strip() if v is not None else ""


def _cell(v) -> str:
    return "" if v is None else str(v).strip()


def _to_int(v) -> Optional[int]:
    s = _cell(v)
    if not s:
        return None
    try:
        return int(float(s))
    except (ValueError, TypeError):
        return None


def _build_header_map(header_row, config: Dict[str, List[str]]) -> Dict[str, int]:
    """表头名 → 列索引；同名列冲突（同一 field 命中多列）留最先出现。"""
    present = {}
    for idx, raw in enumerate(header_row):
        name = _norm_header(raw)
        if name and name not in present:
            present[name] = idx
    field_col: Dict[str, int] = {}
    for fld, names in config.items():
        for cand in names:
            if cand in present:
                field_col[fld] = present[cand]
                break
    return field_col


def _rows_from_xlsx(content: bytes):
    wb = load_workbook(io.BytesIO(content), data_only=True, read_only=True)
    ws = wb.active
    return ws.title, list(ws.iter_rows(values_only=True))


def _rows_from_csv(content: bytes) -> Tuple[str, list, Optional[str]]:
    """CSV → (sheet_name, rows)。必须 UTF-8 BOM，否则返回错误说明。"""
    if content.startswith(b"\xef\xbb\xbf"):
        text = content.decode("utf-8-sig")
    else:
        # 尝试无 BOM 的 UTF-8；解不出则明确拒绝（不猜编码）。
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError:
            return "csv", [], "CSV 编码无法识别（需 UTF-8/带 BOM），请转换后重传"
    reader = csv.reader(io.StringIO(text))
    return "csv", [tuple(r) for r in reader], None


def parse_source_a(content: bytes, filename: str) -> ParseResult:
    """来源A 订阅明细 → 逐行 ParsedRow。"""
    result = ParseResult()
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    try:
        if ext == "csv":
            sheet, all_rows, err = _rows_from_csv(content)
            if err:
                result.issues.append(ParseIssue("block", "A", sheet, None, "", "encoding", err))
                return result
        else:
            sheet, all_rows = _rows_from_xlsx(content)
    except Exception as exc:  # noqa: BLE001
        result.issues.append(ParseIssue("block", "A", filename, None, "", "unreadable", f"来源A 无法读取：{exc}"))
        return result

    if not all_rows:
        result.issues.append(ParseIssue("block", "A", sheet, None, "", "empty", "来源A 无数据行"))
        return result

    header_map = _build_header_map(all_rows[0], SOURCE_A_HEADERS)
    missing = [f for f in SOURCE_A_REQUIRED if f not in header_map]
    if missing:
        result.issues.append(ParseIssue(
            "block", "A", sheet, 1, ",".join(missing), "missing_header",
            f"来源A 缺必备列：{missing}（按表头识别，请核对样本表头）",
        ))
        return result

    def get(row, fld) -> str:
        idx = header_map.get(fld)
        return _cell(row[idx]) if idx is not None and idx < len(row) else ""

    for i, row in enumerate(all_rows[1:], start=2):
        if row is None or all(c is None or _cell(c) == "" for c in row):
            continue  # 跳过空行
        pr = ParsedRow(
            source_file_role="A", source_row=i,
            name=get(row, "name"), phone=get(row, "phone"),
            province=get(row, "province"), city=get(row, "city"), district=get(row, "district"),
            address=get(row, "address"), postal_code=get(row, "postal_code"),
            copies=_to_int(row[header_map["copies"]]) if "copies" in header_map and header_map["copies"] < len(row) else None,
            months=_to_int(row[header_map["months"]]) if "months" in header_map and header_map["months"] < len(row) else None,
            region=get(row, "region"), distribution_unit=get(row, "distribution_unit"),
        )
        result.rows.append(pr)
    return result


def parse_source_b(content: bytes, filename: str) -> ParseResult:
    """来源B 读者统计 → 汇总口径（对账用）。"""
    result = ParseResult()
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    try:
        if ext == "csv":
            sheet, all_rows, err = _rows_from_csv(content)
            if err:
                result.issues.append(ParseIssue("block", "B", sheet, None, "", "encoding", err))
                return result
        else:
            sheet, all_rows = _rows_from_xlsx(content)
    except Exception as exc:  # noqa: BLE001
        result.issues.append(ParseIssue("block", "B", filename, None, "", "unreadable", f"来源B 无法读取：{exc}"))
        return result

    if not all_rows:
        result.issues.append(ParseIssue("warn", "B", sheet, None, "", "empty", "来源B 无数据行（跳过对账）"))
        return result

    header_map = _build_header_map(all_rows[0], SOURCE_B_HEADERS)
    total_count = 0
    total_copies = 0
    by_region: Dict[str, dict] = {}
    for row in all_rows[1:]:
        if row is None or all(c is None or _cell(c) == "" for c in row):
            continue
        region = _cell(row[header_map["region"]]) if "region" in header_map and header_map["region"] < len(row) else ""
        cnt = _to_int(row[header_map["count"]]) if "count" in header_map and header_map["count"] < len(row) else None
        cop = _to_int(row[header_map["copies"]]) if "copies" in header_map and header_map["copies"] < len(row) else None
        total_count += cnt or 0
        total_copies += cop or 0
        if region:
            agg = by_region.setdefault(region, {"count": 0, "copies": 0})
            agg["count"] += cnt or 0
            agg["copies"] += cop or 0
    result.summary_b = {"total_count": total_count, "total_copies": total_copies, "by_region": by_region}
    return result
