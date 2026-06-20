"""add order commercial_status, source_status_raw, is_historical_archive

Phase 3b-1: the commercial (platform) order status as our own curated enum, the
raw platform status string for reference, and the historical-archive flag.
Additive nullable columns — no data change to existing orders.

Revision ID: e1a3c5b7d9f2
Revises: d7f9b1c3e5a8
Create Date: 2026-06-20
"""

from alembic import op
import sqlalchemy as sa


revision = "e1a3c5b7d9f2"
down_revision = "d7f9b1c3e5a8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "orders",
        sa.Column(
            "commercial_status",
            sa.Enum(
                "pending_payment",
                "paid",
                "shipped",
                "refunded",
                "partial_refund",
                "cancelled",
                name="ordercommercialstatus",
            ),
            nullable=True,
        ),
    )
    op.add_column("orders", sa.Column("source_status_raw", sa.String(length=64), nullable=True))
    op.add_column(
        "orders",
        sa.Column(
            "is_historical_archive",
            sa.Boolean(),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("orders", "is_historical_archive")
    op.drop_column("orders", "source_status_raw")
    op.drop_column("orders", "commercial_status")
