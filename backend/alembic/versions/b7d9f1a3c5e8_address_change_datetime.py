"""store address-change time of day

Revision ID: b7d9f1a3c5e8
Revises: f6b8d0e2a4c7
Create Date: 2026-07-23
"""

from alembic import op
import sqlalchemy as sa


revision = "b7d9f1a3c5e8"
down_revision = "f6b8d0e2a4c7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "postal_tickets",
        "change_date",
        existing_type=sa.Date(),
        type_=sa.DateTime(),
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "postal_tickets",
        "change_date",
        existing_type=sa.DateTime(),
        type_=sa.Date(),
        existing_nullable=True,
    )
