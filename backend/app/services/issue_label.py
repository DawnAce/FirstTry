"""Normalised single-issue identity for publications without a sequential 期号.

中国经营报 single issues are identified by their numeric 期号 (``issue_number``,
e.g. 2638). 商学院 is a monthly magazine whose issues are titled
``"2026年1月刊《…》"`` / ``"2026年2~3月合刊《…》"`` — no stable numeric key.

To make per-issue sales aggregatable WITHOUT minting a year-named product for
every issue, we derive a normalised label from the title and store it on the
order item (``order_items.issue_label``):

    "2026年1月刊《AI赋能，乡村新生》"        -> "2026-01"
    "2026年4月刊《AI硬件：元年已至》"        -> "2026-04"
    "2026年2~3月合刊《AI+知识产权…》"        -> "2026-02~03"

The year/month lives here (the issue layer), not in any product-catalog name.
This mirrors the frontend ``guessDefaults`` "N月刊 / N月合刊" detection so the
backend can suggest the label when resolving an unmatched monthly-issue line.
"""

import re
from typing import Optional

# YYYY 年 M 月刊 / YYYY 年 M~N 月合刊 — the trailing 刊 / 合刊 is REQUIRED so a bare
# date token ("2026年1月新春礼包", "…2026年1月特刊") does NOT look like a monthly issue.
# Mirrors the frontend guessDefaults `/月合?刊/` detection.
_MONTHLY_RE = re.compile(
    r"(?P<year>\d{4})\s*年\s*(?P<m1>\d{1,2})\s*(?:[~～\-－]\s*(?P<m2>\d{1,2}))?\s*月\s*合?刊"
)


def normalize_business_school_issue_label(name: Optional[str]) -> Optional[str]:
    """Return a normalised ``"YYYY-MM"`` / ``"YYYY-MM~MM"`` label, or ``None``.

    ``None`` when the string carries no ``YYYY年M月`` issue marker (e.g. a
    subscription or a 期号-based 中国经营报 single issue), so callers can use it
    as a cheap "is this a dated monthly issue?" test.
    """
    if not name:
        return None
    m = _MONTHLY_RE.search(name)
    if not m:
        return None
    year = int(m.group("year"))
    m1 = int(m.group("m1"))
    if not 1 <= m1 <= 12:
        return None
    if m.group("m2"):
        m2 = int(m.group("m2"))
        if 1 <= m2 <= 12 and m2 != m1:
            lo, hi = sorted((m1, m2))
            return f"{year:04d}-{lo:02d}~{hi:02d}"
    return f"{year:04d}-{m1:02d}"
