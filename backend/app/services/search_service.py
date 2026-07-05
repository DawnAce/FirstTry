"""全局搜索 —— 跨 订单 / 收报人 / 商品 / 期数 的轻量检索。

复用各实体列表已有的 search 字段（order_service / recipients / products），各类取 top-N。
规模小、字段多已建索引，用 ``ilike/contains`` 足够，不引入全文索引。
"""

from typing import List

from sqlalchemy import String, cast, or_
from sqlalchemy.orm import Session

from app.models import Issue, Order, Product, Recipient


def global_search(db: Session, q: str, per_type: int = 6) -> List[dict]:
    s = (q or "").strip()
    if not s:
        return []
    like = f"%{s}%"
    items: List[dict] = []

    # 订单：单号 / 外部单号 / 付款人 / 联系电话。
    orders = (
        db.query(Order)
        .filter(
            or_(
                Order.order_code.ilike(like),
                Order.external_order_no.ilike(like),
                Order.payer_name.ilike(like),
                Order.payer_contact.ilike(like),
            )
        )
        .order_by(Order.id.desc())
        .limit(per_type)
        .all()
    )
    for o in orders:
        items.append({
            "type": "order",
            "id": o.id,
            "title": o.order_code or o.external_order_no or f"订单 #{o.id}",
            "subtitle": " · ".join(
                x for x in [
                    o.payer_name,
                    f"¥{o.total_amount}" if o.total_amount is not None else None,
                    o.order_date.isoformat() if o.order_date else None,
                ]
                if x
            ),
            "ref": o.external_order_no,
        })

    # 收报人：姓名 / 电话。
    recipients = (
        db.query(Recipient)
        .filter(or_(Recipient.name.contains(s), Recipient.phone.contains(s)))
        .order_by(Recipient.id.desc())
        .limit(per_type)
        .all()
    )
    for r in recipients:
        loc = "".join(x for x in [r.province, r.city] if x)
        items.append({
            "type": "recipient",
            "id": r.id,
            "title": r.name,
            "subtitle": " · ".join(x for x in [r.phone, loc or None] if x),
            "ref": r.name,
        })

    # 商品：编码 / 名称。
    products = (
        db.query(Product)
        .filter(or_(Product.code.ilike(like), Product.display_name.ilike(like)))
        .order_by(Product.id.desc())
        .limit(per_type)
        .all()
    )
    for p in products:
        items.append({
            "type": "product",
            "id": p.id,
            "title": p.display_name,
            "subtitle": p.code,
            "ref": p.code,
        })

    # 期数：期号（整数，仅当输入为纯数字时匹配）。
    if s.isdigit():
        issues = (
            db.query(Issue)
            .filter(cast(Issue.issue_number, String).like(like))
            .order_by(Issue.issue_number.desc())
            .limit(per_type)
            .all()
        )
        for i in issues:
            items.append({
                "type": "issue",
                "id": i.id,
                "title": f"第 {i.issue_number} 期",
                "subtitle": i.publish_date.isoformat() if i.publish_date else None,
                "ref": str(i.issue_number),
            })

    return items
