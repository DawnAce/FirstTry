"""add actual shipping recipient overrides

Revision ID: f0a2c4e6b8d9
Revises: d4f6a8c0e2b5
"""

from alembic import op
import sqlalchemy as sa


revision = "f0a2c4e6b8d9"
down_revision = "d4f6a8c0e2b5"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("shipping_details", sa.Column("actual_name", sa.String(length=100), nullable=True))
    op.add_column("shipping_details", sa.Column("actual_address", sa.Text(), nullable=True))
    op.add_column("shipping_details", sa.Column("actual_phone", sa.String(length=50), nullable=True))
    op.add_column("shipping_details", sa.Column("actual_adjustment_reason", sa.String(length=255), nullable=True))
    op.add_column("shipping_details", sa.Column("actual_adjusted_at", sa.DateTime(), nullable=True))


def downgrade():
    op.drop_column("shipping_details", "actual_adjusted_at")
    op.drop_column("shipping_details", "actual_adjustment_reason")
    op.drop_column("shipping_details", "actual_phone")
    op.drop_column("shipping_details", "actual_address")
    op.drop_column("shipping_details", "actual_name")
