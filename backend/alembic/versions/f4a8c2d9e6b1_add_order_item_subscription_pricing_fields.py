"""add order item subscription pricing fields

Revision ID: f4a8c2d9e6b1
Revises: e9b3c5d7f1a4
Create Date: 2026-06-04
"""

from alembic import op
import sqlalchemy as sa


revision = "f4a8c2d9e6b1"
down_revision = "e9b3c5d7f1a4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "order_items",
        sa.Column(
            "subscription_term",
            sa.Enum("half_year", "one_year", "custom", name="subscriptionterm"),
            nullable=True,
        ),
    )
    op.add_column(
        "order_items",
        sa.Column(
            "delivery_method",
            sa.Enum("post_office", "zto_mf", name="deliverymethod"),
            nullable=True,
        ),
    )
    op.add_column("order_items", sa.Column("term_start_month", sa.String(length=7), nullable=True))


def downgrade() -> None:
    op.drop_column("order_items", "term_start_month")
    op.drop_column("order_items", "delivery_method")
    op.drop_column("order_items", "subscription_term")
