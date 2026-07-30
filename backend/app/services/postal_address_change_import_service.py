"""邮局改地址导入 —— 解析结果 → PostalAddressChange（preview / commit）。

挂投递：表头年度/修改年度结合原姓名或电话 + 编号(去零)定位，兼容跨年改址和混合年度历史表。
处理情况归一 routed_label。
去重键 (external_order_no, 修改日期, 新地址)。回流动作在 postal_change_service。
"""

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import PostalAddressChange, PostalDelivery
from app.order_import_cache import pop_order_import_session, save_order_import_session
from app.services import postal_common as pc


@dataclass
class AddrPreviewRow:
    external_order_no: str
    old_name: str
    change_date: Optional[str]
    new_address: str
    decision: str  # import | duplicate
    linked: bool = False
    routed_label: Optional[str] = None
    data: Optional[dict] = field(default=None, repr=False)


@dataclass
class AddrImportPreview:
    rows: List[AddrPreviewRow]

    @property
    def counts(self) -> dict:
        c = {"total": len(self.rows), "import": 0, "duplicate": 0, "linked": 0}
        for r in self.rows:
            c[r.decision] = c.get(r.decision, 0) + 1
            if r.decision == "import" and r.linked:
                c["linked"] += 1
        return c

    def importable(self) -> List[AddrPreviewRow]:
        return [r for r in self.rows if r.decision == "import"]


def _key(external, cdate, new_addr):
    # 导入表只有日期；数据库升级为 DateTime 后仍按“当天”判重。
    date_text = cdate.isoformat() if isinstance(cdate, (date, datetime)) else (cdate or "")
    return (external or "", date_text[:10], new_addr or "")


def _source_notes(notes: str, row_no: int) -> str:
    return "；".join(filter(None, (notes, f"来源:邮局年改地址!第{row_no}行")))


def _delivery_year(ac, cdate, deliveries) -> Optional[int]:
    header_year = pc.parse_year(ac.source_year_raw)
    date_year = cdate.year if cdate else None

    def matches(row) -> bool:
        return bool(
            (ac.old_phone and ac.old_phone == row.recipient_phone)
            or (ac.old_name and ac.old_name == row.recipient_name)
        )

    matched = [row for row in deliveries if matches(row)]
    for preferred in (header_year, date_year):
        if preferred and any(row.year == preferred for row in matched):
            return preferred
    years = {row.year for row in matched}
    if len(years) == 1:
        return years.pop()
    available_years = {row.year for row in deliveries}
    if header_year in available_years and date_year not in available_years:
        return header_year
    if date_year in available_years and header_year not in available_years:
        return date_year
    if len(available_years) == 1:
        return available_years.pop()
    return header_year or date_year


def build_address_change_preview(db: Session, rows) -> AddrImportPreview:
    dmap = pc.delivery_map(db)
    deliveries_by_no = {}
    for delivery in db.query(PostalDelivery).filter(PostalDelivery.is_archived.is_(False)).all():
        deliveries_by_no.setdefault(delivery.delivery_no, []).append(delivery)
    existing = {
        _key(e, c.isoformat() if c else None, a)
        for e, c, a in db.query(
            PostalAddressChange.external_order_no,
            PostalAddressChange.change_date,
            PostalAddressChange.new_address,
        ).all()
    }
    seen: set = set()
    out: List[AddrPreviewRow] = []
    for ac in rows:
        cdate = pc.parse_date(ac.change_date_raw)
        cdate_iso = cdate.isoformat() if cdate else None
        no = pc.norm_no(ac.external_no_raw)
        year = _delivery_year(ac, cdate, deliveries_by_no.get(no, []))
        external = f"{year}-{no}" if (year and no) else None

        key = _key(external, cdate_iso, ac.new_address or None)
        if external and (key in existing or key in seen):
            out.append(AddrPreviewRow(external or "(无编号)", ac.old_name, cdate_iso, ac.new_address, "duplicate"))
            continue
        if external:
            seen.add(key)

        rec = dmap.get(external) if external else None
        postal_delivery_id = rec[0] if rec else None
        order_id = rec[1] if rec else None
        routed = pc.routed_label(ac.handling)
        data = {
            "postal_delivery_id": postal_delivery_id,
            "order_id": order_id,
            "external_order_no": external,
            "year": year,
            "change_date": cdate_iso,
            "old_name": ac.old_name or None,
            "old_phone": ac.old_phone or None,
            "old_address": pc.compose_address(ac.old_province, ac.old_city, ac.old_district, ac.old_detail) or None,
            "old_copies": pc.to_int_or_none(ac.old_copies_raw),
            "new_name": ac.new_name or None,
            "new_phone": ac.new_phone or None,
            "new_address": ac.new_address or None,
            "new_copies": pc.to_int_or_none(ac.new_copies_raw),
            "original_start_month": ac.original_start_month or None,
            "effective_start_month": ac.effective_start_month or None,
            "handling": ac.handling or None,
            "routed_label": routed,
            "notes": _source_notes(ac.notes, ac.row_no),
        }
        out.append(AddrPreviewRow(external or "(无编号)", ac.old_name, cdate_iso, ac.new_address,
                                  "import", linked=postal_delivery_id is not None, routed_label=routed, data=data))
    return AddrImportPreview(out)


def _serialize(r: AddrPreviewRow) -> dict:
    return {
        "external_order_no": r.external_order_no,
        "old_name": r.old_name,
        "change_date": r.change_date,
        "new_address": r.new_address,
        "decision": r.decision,
        "linked": r.linked,
        "routed_label": r.routed_label,
    }


def preview_import(db: Session, file_bytes: bytes) -> Tuple[dict, str]:
    from app.services.postal_address_change_parser import (
        is_postal_address_change_export,
        parse_postal_address_changes,
    )

    if not is_postal_address_change_export(file_bytes):
        raise HTTPException(status_code=400, detail="不是邮局改地址表：未找到含「修改日期/新地址/编号」表头的工作表")
    parsed = parse_postal_address_changes(file_bytes)
    preview = build_address_change_preview(db, parsed)
    commit_rows = [{"data": r.data} for r in preview.importable()]
    session_id = save_order_import_session({"mode": "postal_addr", "rows": commit_rows})
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
        _key(e, c.isoformat() if c else None, a)
        for e, c, a in db.query(
            PostalAddressChange.external_order_no,
            PostalAddressChange.change_date,
            PostalAddressChange.new_address,
        ).all()
    }
    created = skipped = 0
    for r in payload["rows"]:
        d = dict(r["data"])
        key = _key(d["external_order_no"], d["change_date"], d["new_address"])
        if d["external_order_no"] and key in existing:
            skipped += 1
            continue
        if d["external_order_no"]:
            existing.add(key)
        d["change_date"] = datetime.fromisoformat(d["change_date"]) if d["change_date"] else None
        db.add(PostalAddressChange(**d))
        created += 1
    db.commit()
    return {"created": created, "skipped_duplicates": skipped}
