"""add postal_address_changes + postal_follow_ups (改地址工单 + 回访)

邮局投递 P3。纯新增两表，挂订单(order_id 可空 SET NULL)。

Revision ID: f3a5c7b9d1e2
Revises: e2f4a6b8c0d1
Create Date: 2026-07-02
"""

from alembic import op
import sqlalchemy as sa


revision = "f3a5c7b9d1e2"
down_revision = "e2f4a6b8c0d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "postal_address_changes",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=True),
        sa.Column("external_order_no", sa.String(length=64), nullable=True),
        sa.Column("change_date", sa.Date(), nullable=True),
        sa.Column("old_name", sa.String(length=128), nullable=True),
        sa.Column("old_phone", sa.String(length=64), nullable=True),
        sa.Column("old_address", sa.Text(), nullable=True),
        sa.Column("old_copies", sa.Integer(), nullable=True),
        sa.Column("new_name", sa.String(length=128), nullable=True),
        sa.Column("new_phone", sa.String(length=64), nullable=True),
        sa.Column("new_address", sa.Text(), nullable=True),
        sa.Column("new_copies", sa.Integer(), nullable=True),
        sa.Column("original_start_month", sa.String(length=16), nullable=True),
        sa.Column("effective_start_month", sa.String(length=16), nullable=True),
        sa.Column("handling", sa.String(length=128), nullable=True),
        sa.Column("routed_label", sa.String(length=64), nullable=True),
        sa.Column("applied_to_order", sa.Boolean(), server_default=sa.text("0"), nullable=False),
        sa.Column("applied_by", sa.Integer(), nullable=True),
        sa.Column("applied_at", sa.DateTime(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], name="fk_postal_addr_order", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["applied_by"], ["users.id"], name="fk_postal_addr_applied_by"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_postal_addr_order_id", "postal_address_changes", ["order_id"], unique=False)
    op.create_index("ix_postal_addr_external_order_no", "postal_address_changes", ["external_order_no"], unique=False)

    op.create_table(
        "postal_follow_ups",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=True),
        sa.Column("external_order_no", sa.String(length=64), nullable=True),
        sa.Column("follow_up_date", sa.Date(), nullable=True),
        sa.Column("batch_label", sa.String(length=32), nullable=True),
        sa.Column("result", sa.Text(), nullable=True),
        sa.Column("snap_name", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], name="fk_postal_follow_order", ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_postal_follow_order_id", "postal_follow_ups", ["order_id"], unique=False)
    op.create_index("ix_postal_follow_external_order_no", "postal_follow_ups", ["external_order_no"], unique=False)


def downgrade() -> None:
    # drop_table 一并删索引与外键，勿在其前 drop_index（MySQL FK 依赖会报错）。
    op.drop_table("postal_follow_ups")
    op.drop_table("postal_address_changes")
