"""add issue_label to order_items

Phase 3c: structured per-issue identity for single-issue lines that have no
sequential 期号 — chiefly 商学院 monthly issues (e.g. "2026年1月刊《…》"). Stored
as a normalised "YYYY-MM" / "YYYY-MM~MM" key so per-issue sales can be
aggregated without the year living in any product-catalog name. Additive
nullable column, indexed for GROUP BY / filtering.

Revision ID: b8e3a1c5d7f0
Revises: f3b5d7c9e1a2
Create Date: 2026-06-22
"""

from alembic import op
import sqlalchemy as sa


revision = "b8e3a1c5d7f0"
down_revision = "f3b5d7c9e1a2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "order_items", sa.Column("issue_label", sa.String(length=32), nullable=True)
    )
    op.create_index("ix_order_items_issue_label", "order_items", ["issue_label"])


def downgrade() -> None:
    op.drop_index("ix_order_items_issue_label", table_name="order_items")
    op.drop_column("order_items", "issue_label")
