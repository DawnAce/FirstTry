"""Clean date-stamped legacy annotations from issue 2638 sub-channels.

Dry-run is the default. Pass ``--apply`` to move matching values into notes,
clear ``sub_channel``, and record one operation log per changed shipping row.
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import asdict, dataclass

from app.database import SessionLocal
from app.models import Issue, ShippingDetail
from app.services.operation_log_service import record_operation


ANNOTATION_PATTERN = re.compile(r"^\d{8}(?:新增|修改|更新|续订|变更).*$")


@dataclass(frozen=True)
class Invariants:
    row_count: int
    planned_quantity: int
    handled_quantity: int
    package_count: int


def _invariants(rows: list[ShippingDetail]) -> Invariants:
    return Invariants(
        row_count=len(rows),
        planned_quantity=sum(row.quantity or 0 for row in rows),
        handled_quantity=sum(row.handled_quantity for row in rows),
        package_count=sum(row.package_count for row in rows),
    )


def _append_legacy_note(notes: str | None, value: str) -> str:
    legacy_note = f"历史说明：{value}"
    parts = [part for part in ((notes or "").strip(), legacy_note) if part]
    return "；".join(parts)


def _candidate_rows(rows: list[ShippingDetail]) -> list[ShippingDetail]:
    return [
        row
        for row in rows
        if row.sub_channel and ANNOTATION_PATTERN.fullmatch(row.sub_channel.strip())
    ]


def run(*, issue_number: int, expected_count: int, apply: bool) -> dict:
    db = SessionLocal()
    try:
        issue = db.query(Issue).filter(Issue.issue_number == issue_number).first()
        if issue is None:
            raise SystemExit(f"未找到第 {issue_number} 期")

        query = (
            db.query(ShippingDetail)
            .filter(ShippingDetail.issue_number == issue_number)
            .order_by(ShippingDetail.id)
        )
        if apply:
            query = query.with_for_update()
        rows = query.all()
        before = _invariants(rows)
        candidates = _candidate_rows(rows)
        preview = [
            {
                "id": row.id,
                "name": row.name,
                "from_sub_channel": row.sub_channel,
                "to_notes": _append_legacy_note(row.notes, row.sub_channel.strip()),
            }
            for row in candidates
        ]

        result = {
            "mode": "apply" if apply else "dry-run",
            "issue_id": issue.id,
            "issue_number": issue.issue_number,
            "publish_date": issue.publish_date.isoformat(),
            "candidate_count": len(candidates),
            "invariants_before": asdict(before),
            "changes": preview,
        }
        if not apply:
            return result

        if len(candidates) != expected_count:
            raise SystemExit(
                f"安全校验失败：预期 {expected_count} 条，实际命中 {len(candidates)} 条，未修改数据"
            )

        for row in candidates:
            old_sub_channel = row.sub_channel.strip()
            old_notes = row.notes
            new_notes = _append_legacy_note(old_notes, old_sub_channel)
            row.sub_channel = None
            row.notes = new_notes
            record_operation(
                db,
                table_name="shipping_details",
                record_id=row.id,
                record_name=row.name,
                action="update",
                username="codex-data-cleanup",
                issue_number=issue_number,
                channel=row.channel,
                changes={
                    "sub_channel": {"old": old_sub_channel, "new": None},
                    "notes": {"old": old_notes, "new": new_notes},
                },
            )

        db.flush()
        after = _invariants(rows)
        if before != after:
            db.rollback()
            raise SystemExit("安全校验失败：明细、份数或运单汇总发生变化，已回滚")
        db.commit()
        result["invariants_after"] = asdict(after)
        return result
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="清理第2638期误入子渠道的日期说明")
    parser.add_argument("--issue-number", type=int, default=2638)
    parser.add_argument("--expected-count", type=int, default=30)
    parser.add_argument("--apply", action="store_true", help="执行修改；缺省仅预览")
    args = parser.parse_args()
    print(json.dumps(run(
        issue_number=args.issue_number,
        expected_count=args.expected_count,
        apply=args.apply,
    ), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
