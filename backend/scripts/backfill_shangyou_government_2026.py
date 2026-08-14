"""Correct and generate the three recurring Shangyou government recipients."""

from __future__ import annotations

import argparse

from app.database import SessionLocal
from app.services.recurring_shipping_detail_service import ensure_recurring_shipping_details


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="commit changes (default: dry run)")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        result = ensure_recurring_shipping_details(db, year=2026, username="codex-backfill")
        print({
            "mode": "apply" if args.apply else "dry-run",
            "year": result.year,
            "active_issue_count": result.active_issue_count,
            "created_count": result.created_count,
            "updated_count": result.updated_count,
            "unchanged_count": result.unchanged_count,
            "changed_issue_numbers": result.changed_issue_numbers,
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
