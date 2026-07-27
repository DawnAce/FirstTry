"""add complaint source

Revision ID: d2f4a6c8e0b1
Revises: c8e1f3a5b7d9
"""

from alembic import op
import sqlalchemy as sa


revision = "d2f4a6c8e0b1"
down_revision = "c8e1f3a5b7d9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("postal_tickets", sa.Column("complaint_source", sa.String(32), nullable=True))


def downgrade() -> None:
    op.drop_column("postal_tickets", "complaint_source")
