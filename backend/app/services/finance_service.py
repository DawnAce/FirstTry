"""财务 · 订单发票工作台聚合（只读）。

以**订单为中心**回答用户的两个问题：哪些订单还没开票（待开票）、哪些订单退了款需要把发票冲红
（需冲红）。口径：看「需开票(invoice_required) 或 已登记过发票」的订单；
``needs_red_reversal`` = 已有正票(normal) + ``order.refunded_amount`` > 0 + **已冲红累计额 < 退款累计额**
（按金额而非「有没有红冲」，以覆盖追加退款 / 部分冲红；红冲未填金额时保守视为已覆盖）。
作废单不清退款 / 不删正票，故 ``active`` + ``void`` 一并查，但 void 单仅在「仍需冲红」时保留
（``order_voided`` 标记，提示这是已作废却有未冲红税票的合规待办）；其余只看 active。
渠道结算的 CRUD 在 ``api/settlements`` 内联（与 contracts 同风格），不在此。
"""

from decimal import Decimal
from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.invoice import Invoice, InvoiceType
from app.models.order import Order, OrderStatus
from app.schemas.finance import InvoiceOrderRow, InvoiceOrdersOut, InvoiceOut

# 工作台状态排序：需冲红最紧急 → 待开票 → 已开票。
_STATE_RANK = {"needs_red_reversal": 0, "pending": 1, "issued": 2}


def _money(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"))


def list_invoice_orders(
    db: Session,
    status: Optional[str] = None,
    q: Optional[str] = None,
) -> InvoiceOrdersOut:
    """发票工作台：相关订单 + 每单发票登记 + 派生状态。

    ``status`` ∈ {pending, issued, needs_red_reversal} 过滤显示行；``q`` 模糊匹配
    订单号 / 付款方。``pending_count`` / ``needs_red_reversal_count`` 为全量汇总，不随筛选变化。
    """
    invoices = db.query(Invoice).order_by(Invoice.id).all()
    by_order: dict[int, list[Invoice]] = {}
    for inv in invoices:
        by_order.setdefault(inv.order_id, []).append(inv)

    conds = [Order.invoice_required.is_(True)]
    if by_order:
        conds.append(Order.id.in_(by_order.keys()))
    # 含 void：作废不会清退款 / 删正票，已开正票+退款仍需冲红是合规待办，不能因作废而消失。
    orders = (
        db.query(Order)
        .filter(Order.status.in_((OrderStatus.active, OrderStatus.void)))
        .filter(or_(*conds))
        .all()
    )

    rows: list[InvoiceOrderRow] = []
    pending_count = 0
    needs_red_count = 0
    for o in orders:
        invs = by_order.get(o.id, [])
        has_normal = any(i.invoice_type == InvoiceType.normal for i in invs)
        red_invs = [i for i in invs if i.invoice_type == InvoiceType.red_reversal]
        refunded = _money(o.refunded_amount)
        # 「是否需冲红」按金额口径：已冲红累计 ≥ 当前累计退款 即视为已覆盖。
        # refunded_amount 是 SUM(refunds) 会随追加退款累加，故布尔「有没有红冲」会漏报追加 / 部分冲红。
        # 任一红冲未填金额 → 无法核算，保守视为已覆盖（沿用 v0 行为，不误催）。
        if red_invs and any(i.amount is None for i in red_invs):
            reversal_covers = True
        else:
            reversed_total = sum((abs(_money(i.amount)) for i in red_invs), Decimal("0"))
            reversal_covers = reversed_total >= refunded
        needs_red = has_normal and refunded > 0 and not reversal_covers

        is_void = o.status == OrderStatus.void
        # 作废单只在「仍需冲红」时保留可见；其余作废单（含纯待开票）不展示——不催作废单开票。
        if is_void and not needs_red:
            continue

        if not has_normal:
            state = "pending"
        elif needs_red:
            state = "needs_red_reversal"
        else:
            state = "issued"

        if state == "pending":
            pending_count += 1
        if needs_red:
            needs_red_count += 1

        rows.append(
            InvoiceOrderRow(
                order_id=o.id,
                order_code=o.order_code,
                payer_name=o.payer_name,
                order_date=o.order_date,
                total_amount=_money(o.total_amount),
                refunded_amount=refunded,
                invoice_required=o.invoice_required,
                invoice_title=o.invoice_title,
                invoice_tax_no=o.invoice_tax_no,
                invoices=[InvoiceOut.model_validate(i) for i in invs],
                invoice_state=state,
                needs_red_reversal=needs_red,
                order_voided=is_void,
            )
        )

    if q and q.strip():
        ql = q.strip().lower()
        rows = [
            r
            for r in rows
            if (r.order_code and ql in r.order_code.lower())
            or ql in r.payer_name.lower()
        ]
    if status in _STATE_RANK:
        rows = [r for r in rows if r.invoice_state == status]

    # 稳定排序：先按下单日期 desc，再按状态紧急度（needs_red → pending → issued）。
    rows.sort(key=lambda r: r.order_date, reverse=True)
    rows.sort(key=lambda r: _STATE_RANK.get(r.invoice_state, 3))

    return InvoiceOrdersOut(
        rows=rows,
        total=len(rows),
        pending_count=pending_count,
        needs_red_reversal_count=needs_red_count,
    )
