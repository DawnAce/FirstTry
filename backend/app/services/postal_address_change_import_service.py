"""邮局改地址导入 —— 解析结果 → PostalAddressChange（preview / commit）。

挂订单：year(修改日期) + 编号(去零) → orders.external_order_no。处理情况归一 routed_label。
去重键 (external_order_no, 修改日期, 新地址)。回流动作在 postal_change_service。
"""

from dataclasses import dataclass, field
from datetime import date
from typing import List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import PostalAddressChange
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
    return (external or "", cdate or "", new_addr or "")


def build_address_change_preview(db: Session, rows) -> AddrImportPreview:
    dmap = pc.delivery_map(db)
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
        # 年度优先取表头括注声明的读者年度（如「…(邮局2024读者明细)」）；缺失才用修改日期年份。
        # 这样跨年改地址（次年初提交上年读者的改址）仍能挂对年份，而不是错挂/漏挂。
        year = pc.parse_year(ac.source_year_raw) or (cdate.year if cdate else None)
        no = pc.norm_no(ac.external_no_raw)
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
            "notes": ac.notes or None,
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
        d["change_date"] = date.fromisoformat(d["change_date"]) if d["change_date"] else None
        db.add(PostalAddressChange(**d))
        created += 1
    db.commit()
    return {"created": created, "skipped_duplicates": skipped}
