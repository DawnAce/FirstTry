"""邮局订报数据生成模块 · 金额与汇总计算（文档 §6）。

金额 = 份数 × 每份完整订期单价；未配置完整订期单价时按「月数 × 20 元」计算。
条数 = 有效明细行数；份数 = Σ 份数；金额 = Σ 金额。
"""

from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable, List

DEFAULT_PRICE_PER_COPY_MONTH = Decimal("20")


def resolve_complete_term_unit_price(
    months,
    configured_unit_price=None,
) -> Decimal:
    """返回每份完整订期价格；显式配置（包括 0）优先，否则按月数 × 20。"""
    if configured_unit_price is not None:
        price = Decimal(str(configured_unit_price))
    else:
        month_count = Decimal(int(months)) if months else Decimal(0)
        price = month_count * DEFAULT_PRICE_PER_COPY_MONTH
    return price.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def compute_amount(copies, months, configured_unit_price=None) -> Decimal:
    """份数 × 完整订期单价 → 两位小数 Decimal；缺份数按 0 计。"""
    c = Decimal(int(copies)) if copies else Decimal(0)
    unit_price = resolve_complete_term_unit_price(months, configured_unit_price)
    return (c * unit_price).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def summarize(records: Iterable) -> dict:
    """对一批 record（含 .copies/.amount/.region_name/.excluded）算总计 + 按地区汇总。"""
    valid = [r for r in records if not getattr(r, "excluded", False)]
    total_count = len(valid)
    total_copies = sum(int(r.copies or 0) for r in valid)
    total_amount = sum((r.amount or Decimal(0)) for r in valid)
    by_region: dict = {}
    for r in valid:
        region = r.region_name or "(未识别地区)"
        agg = by_region.setdefault(region, {"count": 0, "copies": 0, "amount": Decimal(0)})
        agg["count"] += 1
        agg["copies"] += int(r.copies or 0)
        agg["amount"] += (r.amount or Decimal(0))
    return {
        "total_count": total_count,
        "total_copies": total_copies,
        "total_amount": total_amount,
        "region_count": len([k for k in by_region if k != "(未识别地区)"]),
        "by_region": by_region,
    }
