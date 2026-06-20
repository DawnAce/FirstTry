"""Map a messy e-commerce platform order-status string onto our curated
``OrderCommercialStatus`` and decide whether to import it.

We never depend on the platform having a clean/complete vocabulary: exact known
strings map directly; otherwise keyword fallbacks catch variants; anything still
unrecognized defaults to ``paid`` + import **but is flagged** so the operator
confirms it in the preview. The raw string is always stored on the order.

Import / skip policy (agreed):
* 已付款 / 已发货(/已完成) → import
* 待付款 / 已取消(关闭)     → skip (not a real sale)
* 已退款 / 部分退款         → import **and mark** (keep the record; may need to
  stop further delivery — never silently dropped)
"""

from dataclasses import dataclass

from app.models import OrderCommercialStatus


@dataclass
class StatusMapping:
    status: OrderCommercialStatus
    should_import: bool
    unknown: bool = False  # True → not recognized; flag for operator review


# Exact-string map for the statuses seen / expected from CBJ 小程序.
_EXACT = {
    "卖家已发货": StatusMapping(OrderCommercialStatus.shipped, True),
    "已支付，卖家待发货": StatusMapping(OrderCommercialStatus.paid, True),
    "已支付,卖家待发货": StatusMapping(OrderCommercialStatus.paid, True),
    "已完成": StatusMapping(OrderCommercialStatus.shipped, True),
    "交易成功": StatusMapping(OrderCommercialStatus.shipped, True),
    "待付款": StatusMapping(OrderCommercialStatus.pending_payment, False),
    "等待付款": StatusMapping(OrderCommercialStatus.pending_payment, False),
    "已关闭": StatusMapping(OrderCommercialStatus.cancelled, False),
    "交易关闭": StatusMapping(OrderCommercialStatus.cancelled, False),
    "已取消": StatusMapping(OrderCommercialStatus.cancelled, False),
    "已退款": StatusMapping(OrderCommercialStatus.refunded, True),
    "部分退款": StatusMapping(OrderCommercialStatus.partial_refund, True),
}


def map_commercial_status(raw: str | None) -> StatusMapping:
    norm = (raw or "").strip()
    if norm in _EXACT:
        return _EXACT[norm]

    # Keyword fallbacks for unseen variants (order matters: refund before pay).
    if "部分退款" in norm:
        return StatusMapping(OrderCommercialStatus.partial_refund, True)
    if "退款" in norm or "退货" in norm:
        return StatusMapping(OrderCommercialStatus.refunded, True)
    if "关闭" in norm or "取消" in norm:
        return StatusMapping(OrderCommercialStatus.cancelled, False)
    if "待付" in norm or "未付" in norm or "等待付款" in norm:
        return StatusMapping(OrderCommercialStatus.pending_payment, False)
    if "发货" in norm or "完成" in norm or "成功" in norm or "收货" in norm:
        return StatusMapping(OrderCommercialStatus.shipped, True)
    if "付款" in norm or "已支付" in norm or "支付成功" in norm:
        return StatusMapping(OrderCommercialStatus.paid, True)

    # Unrecognized → default to paid + import, but flag for operator confirmation.
    return StatusMapping(OrderCommercialStatus.paid, True, unknown=True)
