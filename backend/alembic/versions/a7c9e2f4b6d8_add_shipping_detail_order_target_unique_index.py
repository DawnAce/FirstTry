"""add shipping detail order target unique index

Revision ID: a7c9e2f4b6d8
Revises: f4a8c2d9e6b1
Create Date: 2026-06-08
"""

from alembic import op


revision = "a7c9e2f4b6d8"
down_revision = "f4a8c2d9e6b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "uq_shipping_detail_order_target_issue",
        "shipping_details",
        ["issue_number", "order_id", "order_item_id", "fulfillment_target_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "uq_shipping_detail_order_target_issue",
        table_name="shipping_details",
    )
