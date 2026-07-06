"""邮局收款/发票 · 列表（筛选 + 分页）+ 手工 CRUD。"""

from typing import List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models import Order, PostalFinance
from app.services import postal_common as pc


def _finance_query(
    db: Session,
    *,
    platform: Optional[str] = None,
    tax_category: Optional[str] = None,
    linked: Optional[bool] = None,
    search: Optional[str] = None,
):
    q = db.query(PostalFinance)
    if platform:
        q = q.filter(PostalFinance.platform == platform)
    if tax_category:
        q = q.filter(PostalFinance.tax_category == tax_category)
    if linked is not None:
        q = q.filter(PostalFinance.order_id.isnot(None) if linked else PostalFinance.order_id.is_(None))
    if search and search.strip():
        s = search.strip()
        q = q.filter(or_(
            PostalFinance.payer_name.contains(s),
            PostalFinance.buyer_title.contains(s),
            PostalFinance.external_order_no.contains(s),
        ))
    return q


def list_finance(
    db: Session,
    *,
    platform: Optional[str] = None,
    tax_category: Optional[str] = None,
    linked: Optional[bool] = None,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
) -> Tuple[List[PostalFinance], int]:
    q = _finance_query(db, platform=platform, tax_category=tax_category, linked=linked, search=search)
    total = q.count()
    rows = (
        q.order_by(PostalFinance.collected_at.desc(), PostalFinance.id.desc())
        .offset(max(0, (page - 1) * page_size)).limit(page_size).all()
    )
    return rows, total


def summarize_finance(
    db: Session,
    *,
    platform: Optional[str] = None,
    tax_category: Optional[str] = None,
    search: Optional[str] = None,
) -> dict:
    """概览行：合计金额 / 合计到款 / 未挂单数（忽略挂单筛选）。"""
    q = _finance_query(db, platform=platform, tax_category=tax_category, linked=None, search=search)
    total_amount = q.with_entities(func.coalesce(func.sum(PostalFinance.amount), 0)).scalar() or 0
    total_net = q.with_entities(func.coalesce(func.sum(PostalFinance.net_amount), 0)).scalar() or 0
    unlinked_count = q.filter(PostalFinance.order_id.is_(None)).count()
    return {
        "total_amount": float(total_amount),
        "total_net": float(total_net),
        "unlinked_count": int(unlinked_count),
    }


# --- 手工 CRUD --------------------------------------------------------

def _resolve_link(db: Session, external: Optional[str], payer_name: Optional[str]) -> tuple:
    """挂单：原始订单号精确优先 → 付款人姓名唯一命中兜底 → 未匹配。返回 (order_id, link_by)。"""
    if external:
        omap = pc.order_map(db)
        if external in omap:
            return omap[external], "order_no"
    if payer_name:
        ids = [oid for (oid,) in db.query(Order.id).filter(Order.payer_name == payer_name).all()]
        if len(ids) == 1:
            return ids[0], "name"
    return None, "none"


def create_finance(db: Session, payload: dict, operator_id: Optional[int] = None) -> PostalFinance:
    """手工新增一条收款/发票。复用挂单（订单号优先/姓名兜底）+ 到款净额 net=金额-手续费 派生。"""
    d = dict(payload)
    order_id, link_by = _resolve_link(db, d.get("external_order_no") or None, d.get("payer_name"))
    amount = d.get("amount")
    fee = d.get("fee_amount")
    if d.get("net_amount") is None and amount is not None and fee is not None:
        d["net_amount"] = amount - fee
    rec = PostalFinance(order_id=order_id, link_by=link_by, **d)
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec


def update_finance(db: Session, finance_id: int, patch: dict) -> PostalFinance:
    rec = db.query(PostalFinance).filter(PostalFinance.id == finance_id).first()
    if rec is None:
        raise HTTPException(status_code=404, detail=f"收款记录 {finance_id} 不存在")
    patch = dict(patch)
    if "external_order_no" in patch or "payer_name" in patch:
        external = patch.get("external_order_no", rec.external_order_no)
        payer = patch.get("payer_name", rec.payer_name)
        rec.order_id, rec.link_by = _resolve_link(db, external or None, payer)
    for k, v in patch.items():
        setattr(rec, k, v)
    if ("amount" in patch or "fee_amount" in patch) and "net_amount" not in patch:
        if rec.amount is not None and rec.fee_amount is not None:
            rec.net_amount = rec.amount - rec.fee_amount
    db.commit()
    db.refresh(rec)
    return rec


def delete_finance(db: Session, finance_id: int) -> None:
    rec = db.query(PostalFinance).filter(PostalFinance.id == finance_id).first()
    if rec is None:
        raise HTTPException(status_code=404, detail=f"收款记录 {finance_id} 不存在")
    db.delete(rec)
    db.commit()
