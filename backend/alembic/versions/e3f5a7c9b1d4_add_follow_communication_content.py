"""add follow-up communication content

Revision ID: e3f5a7c9b1d4
Revises: d2f4a6c8e0b1
"""

from alembic import op
import sqlalchemy as sa


revision = "e3f5a7c9b1d4"
down_revision = "d2f4a6c8e0b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "postal_tickets",
        sa.Column("communication_content", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("postal_tickets", "communication_content")
