"""提现发票导入 —— 解析结果 → PostalFinance（preview / commit）。

链接：**订单号(external_order_no) 优先** → orders.external_order_no；无订单号则**姓名兜底**
（payer_name 唯一命中一张订单才挂，多张/零张 → 未匹配）。发票抬头/税号从「发票信息」正则解析。
去重键 (external_order_no or 姓名, 到款日期, 金额)。
"""

import re
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Order, PostalFinance
from app.order_import_cache import pop_order_import_session, save_order_import_session
from app.services import postal_common as pc


@dataclass
class FinancePreviewRow:
    payer_name: str
    product: str
    amount: Optional[str]
    tax_category: str
    platform: str
    decision: str  # import | duplicate
    linked: bool = False
    link_by: str = "none"
    data: Optional[dict] = field(default=None, repr=False)


@dataclass
class FinanceImportPreview:
    rows: List[FinancePreviewRow]

    @property
    def counts(self) -> dict:
        c = {"total": len(self.rows), "import": 0, "duplicate": 0, "linked": 0}
        for r in self.rows:
            c[r.decision] = c.get(r.decision, 0) + 1
            if r.decision == "import" and r.linked:
                c["linked"] += 1
        return c

    def importable(self) -> List[FinancePreviewRow]:
        return [r for r in self.rows if r.decision == "import"]


def _to_dec(raw: str) -> Optional[Decimal]:
    s = (raw or "").strip().replace("￥", "").replace(",", "")
    if not s:
        return None
    try:
        return Decimal(s)
    except (InvalidOperation, ValueError):
        return None


def _parse_invoice_info(info: str) -> Tuple[Optional[str], Optional[str]]:
    title = tax = None
    m = re.search(r"发票抬头[：:]\s*(.+)", info or "")
    if m:
        title = m.group(1).strip()
    m = re.search(r"购方税号[：:]\s*([0-9A-Za-z]+)", info or "")
    if m:
        tax = m.group(1).strip()
    return title, tax


def _name_map(db: Session) -> dict:
    out: dict = {}
    for name, oid in db.query(Order.payer_name, Order.id).all():
        out.setdefault(name, []).append(oid)
    return out


def _amt(v) -> Optional[str]:
    """金额规范成两位小数串，让 parse("240") 与 DB Numeric("240.00") 的去重键一致。"""
    if v is None or v == "":
        return None
    try:
        return str(Decimal(str(v)).quantize(Decimal("0.01")))
    except (InvalidOperation, ValueError):
        return str(v)


def _key(external, name, cdate, amount):
    return (external or f"name:{name or ''}", cdate or "", _amt(amount) or "")


def build_finance_preview(db: Session, rows) -> FinanceImportPreview:
    omap = pc.order_map(db)
    nmap = _name_map(db)
    existing = {
        _key(e, n, c.isoformat() if c else None, str(a) if a is not None else None)
        for e, n, c, a in db.query(
            PostalFinance.external_order_no, PostalFinance.payer_name,
            PostalFinance.collected_at, PostalFinance.amount,
        ).all()
    }
    seen: set = set()
    out: List[FinancePreviewRow] = []
    for pf in rows:
        external = pf.external_no_raw or None
        cdate = pc.parse_date(pf.collected_raw)
        cdate_iso = cdate.isoformat() if cdate else None
        amount = _to_dec(pf.amount_raw)
        amount_s = str(amount) if amount is not None else None

        key = _key(external, pf.payer_name, cdate_iso, amount_s)
        if key in existing or key in seen:
            out.append(FinancePreviewRow(pf.payer_name, pf.product, amount_s, pf.tax_category, pf.platform, "duplicate"))
            continue
        seen.add(key)

        # 链接：订单号优先，姓名兜底（唯一命中）
        order_id = None
        link_by = "none"
        if external and external in omap:
            order_id, link_by = omap[external], "order_no"
        elif pf.payer_name:
            ids = nmap.get(pf.payer_name, [])
            if len(ids) == 1:
                order_id, link_by = ids[0], "name"

        fee = _to_dec(pf.fee_raw)
        net = _to_dec(pf.net_raw)
        if net is None and amount is not None and fee is not None:
            net = amount - fee
        title, tax = _parse_invoice_info(pf.invoice_info)
        data = {
            "order_id": order_id,
            "external_order_no": external,
            "link_by": link_by,
            "payer_name": pf.payer_name or None,
            "product": pf.product or None,
            "copies": pc.to_int_or_none(pf.copies_raw),
            "amount": str(amount) if amount is not None else None,
            "fee_amount": str(fee) if fee is not None else None,
            "net_amount": str(net) if net is not None else None,
            "collected_at": cdate_iso,
            "invoiced_amount": (lambda v: str(v) if v is not None else None)(_to_dec(pf.invoiced_raw)),
            "buyer_title": title,
            "tax_no": tax,
            "invoice_recipient": pf.recipient or None,
            "tax_category": pf.tax_category or None,
            "platform": pf.platform or None,
        }
        out.append(FinancePreviewRow(
            payer_name=pf.payer_name, product=pf.product, amount=amount_s,
            tax_category=pf.tax_category, platform=pf.platform, decision="import",
            linked=order_id is not None, link_by=link_by, data=data,
        ))
    return FinanceImportPreview(out)


def _serialize(r: FinancePreviewRow) -> dict:
    return {
        "payer_name": r.payer_name, "product": r.product, "amount": r.amount,
        "tax_category": r.tax_category, "platform": r.platform,
        "decision": r.decision, "linked": r.linked, "link_by": r.link_by,
    }


def _dec(v):
    return Decimal(v) if v is not None else None


def preview_import(db: Session, file_bytes: bytes) -> Tuple[dict, str]:
    from app.services.postal_finance_parser import is_postal_finance_export, parse_postal_finance

    if not is_postal_finance_export(file_bytes):
        raise HTTPException(status_code=400, detail="不是提现发票表：未找到含「发票信息/发票类型/到款金额」表头的工作表")
    parsed = parse_postal_finance(file_bytes)
    preview = build_finance_preview(db, parsed)
    commit_rows = [{"data": r.data} for r in preview.importable()]
    session_id = save_order_import_session({"mode": "postal_finance", "rows": commit_rows})
    return {
        "session_id": session_id,
        "counts": preview.counts,
        "can_commit": preview.counts.get("import", 0) > 0,
        "rows": [_serialize(r) for r in preview.rows],
    }, session_id


def commit_import(db: Session, session_id: str, operator_id: Optional[int] = None) -> dict:
    payload = pop_order_import_session(session_id)
    if payload is None:
        raise HTTPException(status_code=400, detail="导入会话不存在或已过期，请重新预览")
    existing = {
        _key(e, n, c.isoformat() if c else None, str(a) if a is not None else None)
        for e, n, c, a in db.query(
            PostalFinance.external_order_no, PostalFinance.payer_name,
            PostalFinance.collected_at, PostalFinance.amount,
        ).all()
    }
    created = skipped = 0
    for r in payload["rows"]:
        d = dict(r["data"])
        key = _key(d["external_order_no"], d["payer_name"], d["collected_at"], d["amount"])
        if key in existing:
            skipped += 1
            continue
        existing.add(key)
        d["collected_at"] = date.fromisoformat(d["collected_at"]) if d["collected_at"] else None
        for f in ("amount", "fee_amount", "net_amount", "invoiced_amount"):
            d[f] = _dec(d[f])
        db.add(PostalFinance(**d))
        created += 1
    db.commit()
    return {"created": created, "skipped_duplicates": skipped}
