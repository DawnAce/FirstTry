"""邮局订报数据生成模块 · 三级校验 + 对账（文档 §7）。

在解析后的行上跑规则，产出问题（block/warn/info）。有 block → 禁止生成。
对账：来源A 明细汇总与来源B 统计口径交叉核对（不一致给警告）。
"""

import re
from typing import List, Optional

_PHONE_RE = re.compile(r"^\+?\d[\d\-\s]{5,20}$")
_POSTAL_RE = re.compile(r"^\d{6}$")


def _issue(level, message, *, source="A", row_no=None, field="", code="", sheet=""):
    return {
        "level": level, "source": source, "sheet_or_file": sheet,
        "row_no": row_no, "field": field, "code": code, "message": message,
    }


def validate_rows(rows: List, summary_b: Optional[dict] = None,
                  dedup_fields=("name", "phone")) -> List[dict]:
    """对解析行做三级校验，返回问题 dict 列表。

    rows: 已补 region_name / months / amount 的行对象（含 source_row / province 等属性）。
    """
    issues: List[dict] = []
    seen = {}

    for r in rows:
        row_no = getattr(r, "source_row", None)

        # 阻断：份数非正。
        copies = getattr(r, "copies", None)
        if not copies or int(copies) <= 0:
            issues.append(_issue("block", f"份数非正数：{copies!r}", row_no=row_no, field="copies", code="copies_non_positive"))

        # 阻断：订阅月数缺失/非正（金额算不出）。
        months = getattr(r, "months", None)
        if not months or int(months) <= 0:
            issues.append(_issue("block", f"订阅月数缺失或非正：{months!r}", row_no=row_no, field="months", code="months_invalid"))

        # 阻断：地址无法识别（规范化后省份仍空）。
        if not (getattr(r, "province", "") or getattr(r, "region_name", "")):
            issues.append(_issue("block", "地址无法识别省/地区", row_no=row_no, field="address", code="address_unresolved"))

        # 警告：电话格式可疑。
        phone = getattr(r, "phone", "")
        if phone and not _PHONE_RE.match(phone):
            issues.append(_issue("warn", f"电话格式可疑：{phone}", row_no=row_no, field="phone", code="phone_suspicious"))

        # 警告：邮编格式可疑。
        postal = getattr(r, "postal_code", "")
        if postal and not _POSTAL_RE.match(postal):
            issues.append(_issue("warn", f"邮编格式可疑：{postal}", row_no=row_no, field="postal_code", code="postal_suspicious"))

        # 阻断：批次内重复订户（默认 姓名+电话，可配置）。
        key = tuple((getattr(r, f, "") or "").strip() for f in dedup_fields)
        if any(key):
            if key in seen:
                issues.append(_issue(
                    "block", f"重复订户（{'+'.join(dedup_fields)}）：与第 {seen[key]} 行重复",
                    row_no=row_no, field="+".join(dedup_fields), code="duplicate_subscriber",
                ))
            else:
                seen[key] = row_no

    # 对账：来源A 份数 vs 来源B 统计份数（B 存在时）。
    if summary_b and summary_b.get("total_copies"):
        a_copies = sum(int(getattr(r, "copies", 0) or 0) for r in rows)
        b_copies = int(summary_b["total_copies"])
        if a_copies != b_copies:
            issues.append(_issue(
                "warn", f"来源A 份数({a_copies}) 与来源B 统计份数({b_copies}) 不一致，请核对",
                source="B", code="cross_source_copies_mismatch",
            ))

    return issues
