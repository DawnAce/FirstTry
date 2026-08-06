"""add waybill import review fields

Revision ID: e0b2d4f6a8c1
Revises: d9e1f3a5b7c9
"""

from alembic import op
import sqlalchemy as sa


revision = "e0b2d4f6a8c1"
down_revision = "d9e1f3a5b7c9"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("shipping_waybill_import_rows", sa.Column("raw_values", sa.JSON(), nullable=True))
    op.add_column(
        "shipping_waybill_import_rows",
        sa.Column("manual_reviewed", sa.Boolean(), server_default=sa.false(), nullable=False),
    )


def downgrade():
    op.drop_column("shipping_waybill_import_rows", "manual_reviewed")
    op.drop_column("shipping_waybill_import_rows", "raw_values")
