"""邮局导入公用小工具（编号归一 / 年度 / 日期 / 处理情况归一 / 订单映射）。"""

import re
from datetime import date
from typing import Optional

from sqlalchemy.orm import Session

from app.models import Order


def norm_no(raw: str) -> Optional[str]:
    """编号去前导零："000680" → "680"；空/无数字 → None。"""
    digits = "".join(ch for ch in (raw or "") if ch.isdigit())
    return str(int(digits)) if digits else None


def parse_year(raw: str) -> Optional[int]:
    digits = "".join(ch for ch in (raw or "") if ch.isdigit())
    return int(digits[:4]) if len(digits) >= 4 else None


def parse_date(raw: str) -> Optional[date]:
    """取前 10 位按 ISO 解析（兼容 "2024-01-03 00:00:00"）。"""
    s = (raw or "").strip()[:10]
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def to_int_or_none(raw: str) -> Optional[int]:
    try:
        return int(float(raw))
    except (ValueError, TypeError):
        return None


def routed_label(handling: str) -> Optional[str]:
    """处理情况归一：\\d*11185 热线 或 XX局（去「转」前缀）。"""
    h = (handling or "").strip().lstrip("转")
    m = re.search(r"[一-龥]{0,3}\d{0,4}11185", h)
    if m and m.group():
        return m.group()
    m = re.search(r"[一-龥]{2,4}局", h)
    if m:
        return m.group()
    return None


def compose_address(province: str, city: str, district: str, detail: str) -> str:
    detail = (detail or "").strip()
    prefix = f"{province or ''}{city or ''}{district or ''}"
    if not detail:
        return prefix
    if province and province[:2] and province[:2] in detail[:8]:
        return detail
    return f"{prefix}{detail}" if prefix else detail


def order_map(db: Session) -> dict:
    """{external_order_no: order_id}，用于按编号挂订单。"""
    return {
        e: oid
        for e, oid in db.query(Order.external_order_no, Order.id)
        .filter(Order.external_order_no.isnot(None))
        .all()
    }


def delivery_map(db: Session) -> dict:
    """{f"{year}-{delivery_no}": (postal_delivery_id, order_id)}，按 年度+编号 关联投递记录。

    工单（投诉/改地址/回访）用它把 编号(去零)+年度 关联到一条投递记录；关联的投递记录若自身
    挂了真实订单则 order_id 一并继承（多数为 None）。
    """
    from app.models import PostalDelivery

    return {
        f"{yr}-{no}": (pid, oid)
        for pid, yr, no, oid in db.query(
            PostalDelivery.id,
            PostalDelivery.year,
            PostalDelivery.delivery_no,
            PostalDelivery.order_id,
        ).all()
    }
