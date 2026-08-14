"""Repair the compact postal-30 rows in issue 2635's preview batch."""

from __future__ import annotations

import argparse

from app.database import SessionLocal
from app.services.shipping_waybill_service import repair_postal_30_preview_rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="commit changes (default: dry run)")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        result = repair_postal_30_preview_rows(
            db,
            issue_number=2635,
            username="codex-repair",
        )
        print({
            "mode": "apply" if args.apply else "dry-run",
            "issue_number": result.issue_number,
            "batch_id": result.batch_id,
            "repaired_rows": result.repaired_rows,
            "repaired_quantity": result.repaired_quantity,
            "row_ids": result.row_ids,
        })
        if args.apply:
            db.commit()
        else:
            db.rollback()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
