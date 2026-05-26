"""Widen narrow text columns in shipping_details

Real-world ZTO shipping data contains long descriptive values in `channel`
(e.g. "样报缴送，中经报1月每期各4份+样报缴送清单") that exceed the original
VARCHAR(20) limit and trigger MySQL error 1406 on import. Widen channel and
related columns so genuine business data fits.

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-05-25
"""
from alembic import op
import sqlalchemy as sa


revision = "b2c3d4e5f6a7"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("shipping_details") as batch_op:
        batch_op.alter_column(
            "channel",
            existing_type=sa.String(length=20),
            type_=sa.String(length=255),
            existing_nullable=False,
        )
        batch_op.alter_column(
            "sub_channel",
            existing_type=sa.String(length=20),
            type_=sa.String(length=255),
            existing_nullable=True,
        )
        batch_op.alter_column(
            "transport",
            existing_type=sa.String(length=20),
            type_=sa.String(length=50),
            existing_nullable=False,
            existing_server_default="中通物流",
        )
        batch_op.alter_column(
            "frequency",
            existing_type=sa.String(length=20),
            type_=sa.String(length=50),
            existing_nullable=False,
            existing_server_default="每周",
        )
        batch_op.alter_column(
            "status",
            existing_type=sa.String(length=10),
            type_=sa.String(length=50),
            existing_nullable=False,
            existing_server_default="正常",
        )
        batch_op.alter_column(
            "confirmation",
            existing_type=sa.String(length=20),
            type_=sa.String(length=50),
            existing_nullable=True,
        )


def downgrade() -> None:
    with op.batch_alter_table("shipping_details") as batch_op:
        batch_op.alter_column(
            "confirmation",
            existing_type=sa.String(length=50),
            type_=sa.String(length=20),
            existing_nullable=True,
        )
        batch_op.alter_column(
            "status",
            existing_type=sa.String(length=50),
            type_=sa.String(length=10),
            existing_nullable=False,
            existing_server_default="正常",
        )
        batch_op.alter_column(
            "frequency",
            existing_type=sa.String(length=50),
            type_=sa.String(length=20),
            existing_nullable=False,
            existing_server_default="每周",
        )
        batch_op.alter_column(
            "transport",
            existing_type=sa.String(length=50),
            type_=sa.String(length=20),
            existing_nullable=False,
            existing_server_default="中通物流",
        )
        batch_op.alter_column(
            "sub_channel",
            existing_type=sa.String(length=255),
            type_=sa.String(length=20),
            existing_nullable=True,
        )
        batch_op.alter_column(
            "channel",
            existing_type=sa.String(length=255),
            type_=sa.String(length=20),
            existing_nullable=False,
        )
