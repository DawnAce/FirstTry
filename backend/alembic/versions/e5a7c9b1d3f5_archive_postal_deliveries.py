"""archive superseded subscription postal deliveries

Revision ID: e5a7c9b1d3f5
Revises: d4e6f8a0b2c4
Create Date: 2026-07-23
"""

from alembic import op
import sqlalchemy as sa


revision = "e5a7c9b1d3f5"
down_revision = "d4e6f8a0b2c4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "postal_delivery",
        sa.Column(
            "is_archived",
            sa.Boolean(),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_postal_delivery_is_archived",
        "postal_delivery",
        ["is_archived"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_postal_delivery_is_archived", table_name="postal_delivery")
    op.drop_column("postal_delivery", "is_archived")
