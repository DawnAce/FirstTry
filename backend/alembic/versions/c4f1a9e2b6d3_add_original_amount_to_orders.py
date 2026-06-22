"""add original_amount (原价/list price) to orders

Phase 3c-2: the CBJ export carries a separate 原价 column (pre-discount list
price) which the parser reads (ParsedOrder.original_amount) but the importer
previously discarded by writing paid_amount into total_amount. Persist it so the
per-campaign report can show list vs paid (discount depth). Additive nullable
column (old/manual orders may have no list price).

Revision ID: c4f1a9e2b6d3
Revises: b8e3a1c5d7f0
Create Date: 2026-06-22
"""

from alembic import op
import sqlalchemy as sa


revision = "c4f1a9e2b6d3"
down_revision = "b8e3a1c5d7f0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "orders", sa.Column("original_amount", sa.Numeric(10, 2), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("orders", "original_amount")
