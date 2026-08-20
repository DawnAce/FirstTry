"""Remove safe imported copies of the generated 2026 Shangyou rows.

The command is a dry run by default. Use ``--apply`` only after reviewing the
candidate count. Applying writes a local ignored JSON backup before deletion.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

from fastapi.encoders import jsonable_encoder
from sqlalchemy import inspect

from app.database import SessionLocal
from app.services.operation_log_service import record_operation
from app.services.recurring_shipping_cleanup_service import (
    build_recurring_duplicate_cleanup_plan,
    delete_recurring_duplicate_candidates,
)
from app.services.recurring_shipping_detail_service import (
    recurring_shipping_invariant_errors,
)


def _backup_rows(rows, *, year: int) -> Path:
    root = Path(__file__).resolve().parents[2]
    backup_dir = root / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    path = backup_dir / f"shangyou-duplicate-shipping-{year}-{timestamp}.json"
    payload = []
    for row in rows:
        values = {
            column.key: getattr(row, column.key)
            for column in inspect(row).mapper.column_attrs
        }
        payload.append(jsonable_encoder(values))
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description="清理2026年上犹固定明细的安全重复副本")
    parser.add_argument("--apply", action="store_true", help="提交删除；默认只预演并回滚")
    parser.add_argument("--expected-count", type=int, help="候选数不等于此值时拒绝提交")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        plan = build_recurring_duplicate_cleanup_plan(db, year=2026)
        print(
            f"扫描固定明细 {plan.scanned_fixed_row_count} 条；"
            f"可清理 {len(plan.candidates)} 条/{plan.candidate_quantity} 份，"
            f"涉及 {len(plan.candidate_issue_numbers)} 期：{plan.candidate_issue_numbers}"
        )
        print(f"受保护 {len(plan.protected)} 条；其他跳过 {len(plan.skipped)} 条")
        if plan.protected:
            print("受保护ID：", [item.detail_id for item in plan.protected])
        if plan.skipped:
            print("跳过ID：", [item.detail_id for item in plan.skipped])

        if not args.apply:
            db.rollback()
            print("预演完成，未修改数据库。")
            return
        if args.expected_count is not None and len(plan.candidates) != args.expected_count:
            db.rollback()
            raise SystemExit(
                f"候选数 {len(plan.candidates)} 与预期 {args.expected_count} 不一致，已拒绝提交。"
            )
        if not plan.candidates:
            db.rollback()
            print("没有可清理记录，未修改数据库。")
            return

        preflight_candidate_ids = plan.candidate_ids
        plan = build_recurring_duplicate_cleanup_plan(
            db,
            year=2026,
            for_update=True,
            only_issue_numbers=plan.candidate_issue_numbers,
        )
        if plan.candidate_ids != preflight_candidate_ids:
            db.rollback()
            raise SystemExit("锁定后候选ID发生变化，已拒绝提交，请重新预演。")

        backup_path = _backup_rows(plan.candidates, year=plan.year)
        deleted_ids = plan.candidate_ids
        affected_issues = plan.candidate_issue_numbers
        deleted_quantity = plan.candidate_quantity
        delete_recurring_duplicate_candidates(db, plan)
        invariant_errors = [
            error
            for issue_number in affected_issues
            for error in recurring_shipping_invariant_errors(
                db,
                issue_number=issue_number,
                year=plan.year,
                for_update=True,
            )
        ]
        if invariant_errors:
            db.rollback()
            raise SystemExit(f"删除后固定明细不变量校验失败：{invariant_errors[0]}")

        record_operation(
            db,
            table_name="shipping_details",
            record_id=0,
            record_name="2026年上犹固定明细重复清理",
            action="delete_duplicate",
            username="codex-cleanup",
            changes={
                "year": plan.year,
                "deleted_count": len(deleted_ids),
                "deleted_quantity": deleted_quantity,
                "deleted_ids": deleted_ids,
                "affected_issue_numbers": affected_issues,
                "protected_count": len(plan.protected),
                "skipped_count": len(plan.skipped),
                "backup_filename": backup_path.name,
            },
        )
        db.commit()
        print(
            f"已提交：删除 {len(deleted_ids)} 条/{deleted_quantity} 份；"
            f"本地备份：{backup_path}"
        )
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
