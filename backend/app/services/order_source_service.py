"""原始交易留存及归属。写操作由调用入口统一提交。"""
import hashlib
import json
import re
from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.models import Order, OrderCommercialStatus
from app.models.order_source import OrderSource, OrderSourceEvent, OrderSourceLink, OrderSourceVersion
from app.services.cbj_order_import_parser import ParsedOrder
from app.services.order_import_status_service import map_commercial_status


def normalize(value: str | None) -> str:
    """仅去空白及常见分隔符，保留门牌号和有意义字符。"""
    return re.sub(r"[\s，,。；;：:（）()\-]+", "", value or "").casefold()


def source_snapshot(po: ParsedOrder, platform: str, store: str | None, filename: str | None) -> dict:
    return {
        "platform": platform, "store": store or "", "external_order_no": po.external_order_no,
        "order_date": po.order_date.isoformat() if po.order_date else None,
        "payment_time": po.payment_time.isoformat() if po.payment_time else None,
        "paid_amount": str(po.paid_amount.quantize(Decimal("0.01"))),
        "original_amount": str(po.original_amount.quantize(Decimal("0.01"))),
        "status_raw": po.status_raw, "commercial_status": map_commercial_status(po.status_raw).status.value,
        "recipient_name": po.recipient_name, "recipient_phone": po.recipient_phone,
        "recipient_address": po.recipient_address, "recipient_postal_code": po.recipient_postal_code,
        "notes": po.notes, "payment_method": po.payment_method_raw, "invoice": po.invoice_raw,
        "product_lines": [{"raw": p.raw, "name": p.name, "quantity": p.quantity,
                           "unit_price": str(p.unit_price), "is_shipping": p.is_shipping,
                           "mentions_zto": p.mentions_zto} for p in po.product_lines],
        "filename": filename, "source_sheet": po.source_sheet, "source_row": po.source_row,
        "raw_cells": po.raw_cells,
    }


def fingerprint(snapshot: dict) -> str:
    content = {k: v for k, v in snapshot.items() if k not in {"filename", "source_sheet", "source_row"}}
    return hashlib.sha256(json.dumps(content, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def identity_query(db: Session, snapshot: dict):
    return db.query(OrderSource).filter(
        OrderSource.platform == snapshot["platform"], OrderSource.store == snapshot["store"],
        OrderSource.external_order_no == snapshot["external_order_no"])


def source_event(db: Session, source: OrderSource, action: str, payload: dict, operator_id: int | None) -> None:
    db.add(OrderSourceEvent(source_id=source.id, action=action, payload=payload, operator_id=operator_id))


def validate_import_sources(db: Session, records: list[dict], confirmed: list[str]) -> None:
    for record in records:
        snapshot = record["snapshot"]
        current = identity_query(db, snapshot).with_for_update().first()
        expected = record["expected_revision"]
        if expected is not None and (current is None or current.lock_version != expected):
            raise HTTPException(409, "来源交易已变化，请重新预览后确认")
        if record["decision"] == "source_update" and snapshot["external_order_no"] not in confirmed:
            raise HTTPException(409, "来源交易有变化，请逐笔核对并确认更新")
        if expected is None and current is not None:
            version = db.query(OrderSourceVersion).filter_by(source_id=current.id, revision=current.revision).one()
            if version.fingerprint != fingerprint(snapshot):
                raise HTTPException(409, "来源交易已被另一次导入，请重新预览")


def save_import_source(db: Session, record: dict, order: Order | None, operator_id: int | None) -> tuple[OrderSource, bool]:
    snapshot = record["snapshot"]
    source = identity_query(db, snapshot).first()
    digest = fingerprint(snapshot)
    if source is not None:
        version = db.query(OrderSourceVersion).filter_by(source_id=source.id, revision=source.revision).one()
        if version.fingerprint == digest:
            return source, False
        source.revision += 1
        source.lock_version += 1
        # 原始状态更新不等于退款流水确认，也不回写订阅履约或财务。
        source.verified_refund_amount = None
        source.verified_refund_date = None
    else:
        source = OrderSource(platform=snapshot["platform"], store=snapshot["store"],
                             external_order_no=snapshot["external_order_no"], kind=record["kind"],
                             revision=1, created_by=operator_id)
        db.add(source)
    source.order_date = date.fromisoformat(snapshot["order_date"]) if snapshot["order_date"] else None
    source.recipient_name = normalize(snapshot["recipient_name"])
    source.recipient_phone = normalize(snapshot["recipient_phone"])
    source.recipient_address = normalize(snapshot["recipient_address"])
    source.paid_amount = Decimal(snapshot["paid_amount"])
    source.commercial_status = snapshot["commercial_status"]
    db.flush()
    db.add(OrderSourceVersion(source_id=source.id, revision=source.revision, fingerprint=digest,
                              snapshot=snapshot, search_text=normalize(json.dumps(snapshot, ensure_ascii=False)),
                              created_by=operator_id))
    if order is not None and source.revision == 1:
        db.add(OrderSourceLink(source_id=source.id, order_id=order.id, amount=source.paid_amount,
                               active=1, reason="原始订阅交易", created_by=operator_id))
    source_event(db, source, "imported" if source.revision == 1 else "source_updated",
                 {"revision": source.revision, "kind": source.kind}, operator_id)
    return source, True


def source_search_ids(term: str):
    # 子查询在分页前执行；历史版本同样可被检索，主列表不因多个命中而重复。
    return select(OrderSourceVersion.source_id).where(
        OrderSourceVersion.search_text.contains(normalize(term), autoescape=True))


def source_order_ids(term: str):
    return select(OrderSourceLink.order_id).where(
        OrderSourceLink.active == 1, OrderSourceLink.source_id.in_(source_search_ids(term)))
