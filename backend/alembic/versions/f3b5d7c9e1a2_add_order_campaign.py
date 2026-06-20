"""add campaign tag to orders

Phase 3b-4: marketing-campaign tag (e.g. 2026-618) on e-commerce orders. Set per
import batch for traceability + per-campaign reporting. Additive nullable column,
indexed for filtering/counting by campaign.

Revision ID: f3b5d7c9e1a2
Revises: e1a3c5b7d9f2
Create Date: 2026-06-20
"""

from alembic import op
import sqlalchemy as sa


revision = "f3b5d7c9e1a2"
down_revision = "e1a3c5b7d9f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("campaign", sa.String(length=64), nullable=True))
    op.create_index("ix_orders_campaign", "orders", ["campaign"])


def downgrade() -> None:
    op.drop_index("ix_orders_campaign", table_name="orders")
    op.drop_column("orders", "campaign")
