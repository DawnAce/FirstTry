"""邮局投诉导入 —— 解析结果 → PostalComplaint（preview / commit）。

每行 → 一条投诉工单。挂订单：``编号``("000680")去零 + ``年度`` → ``f"{year}-{no}"`` 匹配
``orders.external_order_no``（匹配不到则 order_id 留空、external 字符串保留）。处理情况原文保留，
另抽 ``routed_label``(热线 \\d*11185 或 XX局)。状态：有回访→resolved 否则 open。去重键：
(external_order_no, 接诉日期, 投诉情况) —— 同人可多次接诉，故带日期+情况区分。
"""

import re
from dataclasses import dataclass, field
from datetime import date
from typing import List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Partner, PartnerType, PostalComplaint, PostalComplaintStatus, PostalDelivery
from app.order_import_cache import pop_order_import_session, save_order_import_session


@dataclass
class ComplaintPreviewRow:
    external_order_no: str
    name: str
    complaint_date: Optional[str]
    missing_issues: str
    decision: str  # import | duplicate
    linked: bool = False
    routed_label: Optional[str] = None
    distribution_unit: str = ""
    status: str = "open"
    data: Optional[dict] = field(default=None, repr=False)


@dataclass
class ComplaintImportPreview:
    rows: List[ComplaintPreviewRow]

    @property
    def counts(self) -> dict:
        c = {"total": len(self.rows), "import": 0, "duplicate": 0, "linked": 0}
        for r in self.rows:
            c[r.decision] = c.get(r.decision, 0) + 1
            if r.decision == "import" and r.linked:
                c["linked"] += 1
        return c

    def importable(self) -> List[ComplaintPreviewRow]:
        return [r for r in self.rows if r.decision == "import"]


def _parse_year(raw: str) -> Optional[int]:
    digits = "".join(ch for ch in (raw or "") if ch.isdigit())
    return int(digits[:4]) if len(digits) >= 4 else None


def _norm_no(raw: str) -> Optional[str]:
    digits = "".join(ch for ch in (raw or "") if ch.isdigit())
    return str(int(digits)) if digits else None


def _parse_date(raw: str) -> Optional[date]:
    s = (raw or "").strip()[:10]
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def _to_int_or_none(raw: str) -> Optional[int]:
    try:
        return int(float(raw))
    except (ValueError, TypeError):
        return None


def _routed_label(handling: str) -> Optional[str]:
    h = (handling or "").strip().lstrip("转")
    m = re.search(r"[一-龥]{0,3}\d{0,4}11185", h)
    if m and m.group():
        return m.group()
    m = re.search(r"[一-龥]{2,4}局", h)
    if m:
        return m.group()
    return None


def _compose_addr(pc) -> str:
    detail = (pc.detail_address or "").strip()
    prefix = f"{pc.province}{pc.city}{pc.district}"
    if not detail:
        return prefix
    if pc.province and pc.province[:2] and pc.province[:2] in detail[:8]:
        return detail
    return f"{prefix}{detail}" if prefix else detail


def _dedup_key(external: Optional[str], cdate: Optional[str], missing: Optional[str]) -> tuple:
    return (external or "", cdate or "", missing or "")


def build_complaint_preview(db: Session, rows) -> ComplaintImportPreview:
    # 按 年度+编号 关联投递记录：{f"{year}-{no}": (postal_delivery_id, order_id)}。
    delivery_map = {
        f"{y}-{n}": (pid, oid)
        for pid, y, n, oid in db.query(
            PostalDelivery.id,
            PostalDelivery.year,
            PostalDelivery.delivery_no,
            PostalDelivery.order_id,
        ).all()
    }
    dist_map = {
        name: pid
        for name, pid in db.query(Partner.name, Partner.id)
        .filter(Partner.partner_type == PartnerType.distribution)
        .all()
    }
    existing = {
        _dedup_key(e, c.isoformat() if c else None, m)
        for e, c, m in db.query(
            PostalComplaint.external_order_no,
            PostalComplaint.complaint_date,
            PostalComplaint.missing_issues,
        ).all()
    }
    seen: set = set()

    out: List[ComplaintPreviewRow] = []
    for pc in rows:
        year = _parse_year(pc.year_raw)
        no = _norm_no(pc.external_no_raw)
        external = f"{year}-{no}" if (year and no) else None
        cdate = _parse_date(pc.complaint_date_raw)
        cdate_iso = cdate.isoformat() if cdate else None

        key = _dedup_key(external, cdate_iso, pc.missing_issues or None)
        if key in existing or key in seen:
            out.append(ComplaintPreviewRow(external or "(无编号)", pc.name, cdate_iso,
                                           pc.missing_issues, "duplicate"))
            continue
        seen.add(key)

        rec = delivery_map.get(external) if external else None
        postal_delivery_id = rec[0] if rec else None
        order_id = rec[1] if rec else None
        routed = _routed_label(pc.handling)
        dist_id = dist_map.get(pc.distribution_unit_name) if pc.distribution_unit_name else None
        status = "resolved" if (pc.follow_up or "").strip() else "open"
        data = {
            "postal_delivery_id": postal_delivery_id,
            "order_id": order_id,
            "external_order_no": external,
            "complaint_date": cdate_iso,
            "year": year,
            "missing_issues": pc.missing_issues or None,
            "handling": pc.handling or None,
            "routed_label": routed,
            "routed_unit_id": dist_id,
            "follow_up": pc.follow_up or None,
            "handling_count": _to_int_or_none(pc.handling_count_raw),
            "status": status,
            "first_handler": pc.first_handler or None,
            "snap_name": pc.name or None,
            "snap_phone": pc.phone or None,
            "snap_address": _compose_addr(pc) or None,
            "snap_postal_code": pc.postal_code or None,
            "notes": pc.notes or None,
        }
        out.append(ComplaintPreviewRow(
            external_order_no=external or "(无编号)",
            name=pc.name,
            complaint_date=cdate_iso,
            missing_issues=pc.missing_issues,
            decision="import",
            linked=postal_delivery_id is not None,
            routed_label=routed,
            distribution_unit=pc.distribution_unit_name,
            status=status,
            data=data,
        ))
    return ComplaintImportPreview(out)


def _serialize(r: ComplaintPreviewRow) -> dict:
    return {
        "external_order_no": r.external_order_no,
        "name": r.name,
        "complaint_date": r.complaint_date,
        "missing_issues": r.missing_issues,
        "decision": r.decision,
        "linked": r.linked,
        "routed_label": r.routed_label,
        "distribution_unit": r.distribution_unit,
        "status": r.status,
    }


def preview_import(db: Session, file_bytes: bytes) -> Tuple[dict, str]:
    from app.services.postal_complaint_parser import (
        is_postal_complaint_export,
        parse_postal_complaints,
    )

    if not is_postal_complaint_export(file_bytes):
        raise HTTPException(
            status_code=400,
            detail="不是邮局投诉表：未找到含「投诉情况/处理情况/编号/接诉日期」表头的工作表",
        )
    parsed = parse_postal_complaints(file_bytes)
    preview = build_complaint_preview(db, parsed)
    commit_rows = [{"data": r.data} for r in preview.importable()]
    session_id = save_order_import_session({"mode": "postal_complaint", "rows": commit_rows})
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
        _dedup_key(e, c.isoformat() if c else None, m)
        for e, c, m in db.query(
            PostalComplaint.external_order_no,
            PostalComplaint.complaint_date,
            PostalComplaint.missing_issues,
        ).all()
    }
    created = 0
    skipped = 0
    for r in payload["rows"]:
        d = dict(r["data"])
        key = _dedup_key(d["external_order_no"], d["complaint_date"], d["missing_issues"])
        if key in existing:
            skipped += 1
            continue
        existing.add(key)
        d["complaint_date"] = date.fromisoformat(d["complaint_date"]) if d["complaint_date"] else None
        d["status"] = PostalComplaintStatus(d["status"])
        db.add(PostalComplaint(**d))
        created += 1
    db.commit()
    return {"created": created, "skipped_duplicates": skipped}
