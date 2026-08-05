"""add report source contribution ledger

Revision ID: a8c1e4f7b2d5
Revises: f5c7e9a1b3d6
Create Date: 2026-08-05
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a8c1e4f7b2d5"
down_revision: Union[str, None] = "f5c7e9a1b3d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "report_source_items",
        sa.Column("source_action", sa.String(length=30), nullable=False, server_default="base"),
    )
    op.add_column(
        "report_source_items",
        sa.Column("applied_phase", sa.String(length=30), nullable=False, server_default="pre_confirmation"),
    )
    op.add_column(
        "report_source_items",
        sa.Column("print_delta", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "report_source_items",
        sa.Column("effect_status", sa.String(length=20), nullable=False, server_default="active"),
    )
    op.add_column("report_source_items", sa.Column("supersedes_item_id", sa.Integer(), nullable=True))
    op.create_index("ix_report_source_items_source_action", "report_source_items", ["source_action"])
    op.create_index("ix_report_source_items_applied_phase", "report_source_items", ["applied_phase"])
    op.create_index("ix_report_source_items_effect_status", "report_source_items", ["effect_status"])
    op.create_index("ix_report_source_items_supersedes_item_id", "report_source_items", ["supersedes_item_id"])
    op.create_foreign_key(
        "fk_report_source_items_supersedes_item_id",
        "report_source_items",
        "report_source_items",
        ["supersedes_item_id"],
        ["id"],
        ondelete="SET NULL",
    )

    bind = op.get_bind()
    rows = bind.execute(sa.text("""
        SELECT i.id, i.issue_number, i.category, i.sub_category,
               i.item_kind, i.adjustment_kind, i.applied_quantity,
               i.source_status, i.confirmed_at, i.created_at
        FROM report_source_items i
        ORDER BY i.issue_number, i.category, i.sub_category,
                 COALESCE(i.confirmed_at, i.created_at), i.id
    """)).mappings().all()
    seen_confirmed_bases: set[tuple[int, str, str]] = set()
    for row in rows:
        if row["item_kind"] == "adjustment":
            action = {
                "billable_addition": "postpress_addition",
                "replacement": "damage_reshipment",
                "reduction": "reduction",
            }.get(row["adjustment_kind"], "archive_only")
            phase = "post_confirmation"
            print_delta = 0
        else:
            key = (row["issue_number"], row["category"], row["sub_category"])
            is_later_confirmed = row["source_status"] == "confirmed" and key in seen_confirmed_bases
            action = "prepress_addition" if is_later_confirmed else "base"
            phase = "pre_confirmation"
            print_delta = row["applied_quantity"] or 0
            if row["source_status"] == "confirmed":
                seen_confirmed_bases.add(key)
        bind.execute(
            sa.text("""
                UPDATE report_source_items
                SET source_action = :action,
                    applied_phase = :phase,
                    print_delta = :print_delta
                WHERE id = :item_id
            """),
            {
                "action": action,
                "phase": phase,
                "print_delta": print_delta,
                "item_id": row["id"],
            },
        )

    # The legacy implementation wrote only the latest confirmed file into a
    # draft report entry.  Rebuild editable entries from the newly classified
    # contributions so, for example, 350 + 15 becomes 365 immediately after
    # deployment.  Confirmed issues remain locked and are never rewritten.
    contribution_rows = bind.execute(sa.text("""
        SELECT iss.id AS issue_id, i.category, i.sub_category,
               SUM(i.print_delta) AS source_total
        FROM report_source_items i
        JOIN issues iss ON iss.issue_number = i.issue_number
        WHERE iss.status <> 'confirmed'
          AND i.source_status = 'confirmed'
          AND i.effect_status = 'active'
          AND i.source_action IN ('base', 'prepress_addition')
        GROUP BY iss.id, i.category, i.sub_category
    """)).mappings().all()
    for row in contribution_rows:
        bind.execute(
            sa.text("""
                UPDATE report_entries
                SET value = :source_total
                WHERE issue_id = :issue_id
                  AND category = :category
                  AND sub_category = :sub_category
            """),
            {
                "source_total": row["source_total"],
                "issue_id": row["issue_id"],
                "category": row["category"],
                "sub_category": row["sub_category"],
            },
        )


def downgrade() -> None:
    op.drop_constraint("fk_report_source_items_supersedes_item_id", "report_source_items", type_="foreignkey")
    op.drop_index("ix_report_source_items_supersedes_item_id", table_name="report_source_items")
    op.drop_index("ix_report_source_items_effect_status", table_name="report_source_items")
    op.drop_index("ix_report_source_items_applied_phase", table_name="report_source_items")
    op.drop_index("ix_report_source_items_source_action", table_name="report_source_items")
    op.drop_column("report_source_items", "supersedes_item_id")
    op.drop_column("report_source_items", "effect_status")
    op.drop_column("report_source_items", "print_delta")
    op.drop_column("report_source_items", "applied_phase")
    op.drop_column("report_source_items", "source_action")
