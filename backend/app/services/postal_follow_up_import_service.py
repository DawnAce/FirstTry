"""回访导入 —— 解析结果 → PostalFollowUp（preview / commit）。

挂订单：年度 + 编号(去零) → orders.external_order_no。列头 "20240227回访" → 回访日期。
去重键 (external_order_no or 姓名, batch_label)。
"""

from dataclasses import dataclass, field
from datetime import date
from typing import List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import PostalFollowUp
from app.order_import_cache import pop_order_import_session, save_order_import_session
from app.services import postal_common as pc


@dataclass
class FollowPreviewRow:
    external_order_no: str
    name: str
    batch_label: str
    follow_up_date: Optional[str]
    result: str
    decision: str  # import | duplicate
    linked: bool = False
    data: Optional[dict] = field(default=None, repr=False)


@dataclass
class FollowImportPreview:
    rows: List[FollowPreviewRow]

    @property
    def counts(self) -> dict:
        c = {"total": len(self.rows), "import": 0, "duplicate": 0, "linked": 0}
        for r in self.rows:
            c[r.decision] = c.get(r.decision, 0) + 1
            if r.decision == "import" and r.linked:
                c["linked"] += 1
        return c

    def importable(self) -> List[FollowPreviewRow]:
        return [r for r in self.rows if r.decision == "import"]


def _date_from_label(label: str) -> Optional[date]:
    """"20240227回访" → 2024-02-27；位数不足(如 "2025回访") → None。"""
    digits = "".join(ch for ch in (label or "") if ch.isdigit())
    if len(digits) == 8:
        try:
            return date(int(digits[:4]), int(digits[4:6]), int(digits[6:8]))
        except ValueError:
            return None
    return None


def _key(external, name, label):
    return (external or f"name:{name}", label or "")


def build_follow_up_preview(db: Session, rows) -> FollowImportPreview:
    omap = pc.order_map(db)
    existing = {
        _key(e, n, b)
        for e, n, b in db.query(
            PostalFollowUp.external_order_no,
            PostalFollowUp.snap_name,
            PostalFollowUp.batch_label,
        ).all()
    }
    seen: set = set()
    out: List[FollowPreviewRow] = []
    for fu in rows:
        year = pc.parse_year(fu.year_raw)
        no = pc.norm_no(fu.external_no_raw)
        external = f"{year}-{no}" if (year and no) else None
        key = _key(external, fu.name, fu.batch_label)
        if external and (key in existing or key in seen):
            out.append(FollowPreviewRow(external or "(无编号)", fu.name, fu.batch_label, None, fu.result, "duplicate"))
            continue
        if external:
            seen.add(key)
        fdate = _date_from_label(fu.batch_label)
        order_id = omap.get(external) if external else None
        data = {
            "order_id": order_id,
            "external_order_no": external,
            "follow_up_date": fdate.isoformat() if fdate else None,
            "batch_label": fu.batch_label,
            "result": fu.result or None,
            "snap_name": fu.name or None,
        }
        out.append(FollowPreviewRow(external or "(无编号)", fu.name, fu.batch_label,
                                    data["follow_up_date"], fu.result, "import",
                                    linked=order_id is not None, data=data))
    return FollowImportPreview(out)


def _serialize(r: FollowPreviewRow) -> dict:
    return {
        "external_order_no": r.external_order_no,
        "name": r.name,
        "batch_label": r.batch_label,
        "follow_up_date": r.follow_up_date,
        "result": r.result,
        "decision": r.decision,
        "linked": r.linked,
    }


def preview_import(db: Session, file_bytes: bytes) -> Tuple[dict, str]:
    from app.services.postal_follow_up_parser import (
        is_postal_follow_up_export,
        parse_postal_follow_ups,
    )

    if not is_postal_follow_up_export(file_bytes):
        raise HTTPException(status_code=400, detail="未找到含「回访」列的邮局读者明细工作表")
    parsed = parse_postal_follow_ups(file_bytes)
    preview = build_follow_up_preview(db, parsed)
    commit_rows = [{"data": r.data} for r in preview.importable()]
    session_id = save_order_import_session({"mode": "postal_follow", "rows": commit_rows})
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
        _key(e, n, b)
        for e, n, b in db.query(
            PostalFollowUp.external_order_no,
            PostalFollowUp.snap_name,
            PostalFollowUp.batch_label,
        ).all()
    }
    created = skipped = 0
    for r in payload["rows"]:
        d = dict(r["data"])
        key = _key(d["external_order_no"], d["snap_name"], d["batch_label"])
        if d["external_order_no"] and key in existing:
            skipped += 1
            continue
        if d["external_order_no"]:
            existing.add(key)
        d["follow_up_date"] = date.fromisoformat(d["follow_up_date"]) if d["follow_up_date"] else None
        db.add(PostalFollowUp(**d))
        created += 1
    db.commit()
    return {"created": created, "skipped_duplicates": skipped}
