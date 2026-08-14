"""add recurring generated shipping source

Revision ID: a2c4e6f8b0d3
Revises: f0a2c4e6b8d9
"""

from alembic import op
import sqlalchemy as sa


revision = "a2c4e6f8b0d3"
down_revision = "f0a2c4e6b8d9"
branch_labels = None
depends_on = None


_OLD_VALUES = ("manual", "order_generated", "historical_import", "complaint_makeup")
_NEW_VALUES = (*_OLD_VALUES, "recurring_generated")


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(sa.text(
            "ALTER TYPE shippingdetailsourcetype "
            "ADD VALUE IF NOT EXISTS 'recurring_generated'"
        ))
    elif bind.dialect.name == "mysql":
        op.alter_column(
            "shipping_details",
            "source_type",
            existing_type=sa.Enum(*_OLD_VALUES),
            type_=sa.Enum(*_NEW_VALUES),
            existing_nullable=False,
            existing_server_default="manual",
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "mysql":
        op.execute(sa.text(
            "UPDATE shipping_details SET source_type = 'manual' "
            "WHERE source_type = 'recurring_generated'"
        ))
        op.alter_column(
            "shipping_details",
            "source_type",
            existing_type=sa.Enum(*_NEW_VALUES),
            type_=sa.Enum(*_OLD_VALUES),
            existing_nullable=False,
            existing_server_default="manual",
        )
