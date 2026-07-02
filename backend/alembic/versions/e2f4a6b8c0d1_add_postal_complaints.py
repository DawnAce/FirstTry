"""add postal_complaints (邮局投诉工单)

邮局投递 P2：投诉工单，挂邮局订单(order_id 可空，按 年度+编号 匹配)。纯新增。

Revision ID: e2f4a6b8c0d1
Revises: d0e1f2a3b4c5
Create Date: 2026-07-02
"""

from alembic import op
import sqlalchemy as sa


revision = "e2f4a6b8c0d1"
down_revision = "d0e1f2a3b4c5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "postal_complaints",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=True),
        sa.Column("external_order_no", sa.String(length=64), nullable=True),
        sa.Column("complaint_date", sa.Date(), nullable=True),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("missing_issues", sa.Text(), nullable=True),
        sa.Column("handling", sa.Text(), nullable=True),
        sa.Column("routed_label", sa.String(length=64), nullable=True),
        sa.Column("routed_unit_id", sa.Integer(), nullable=True),
        sa.Column("follow_up", sa.Text(), nullable=True),
        sa.Column("handling_count", sa.Integer(), nullable=True),
        sa.Column(
            "status",
            sa.Enum("open", "resolved", name="postalcomplaintstatus"),
            server_default="open",
            nullable=False,
        ),
        sa.Column("first_handler", sa.String(length=64), nullable=True),
        sa.Column("snap_name", sa.String(length=128), nullable=True),
        sa.Column("snap_phone", sa.String(length=64), nullable=True),
        sa.Column("snap_address", sa.Text(), nullable=True),
        sa.Column("snap_postal_code", sa.String(length=20), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["order_id"], ["orders.id"], name="fk_postal_complaints_order", ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["routed_unit_id"], ["partners.id"],
            name="fk_postal_complaints_routed_unit", ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_postal_complaints_order_id", "postal_complaints", ["order_id"], unique=False)
    op.create_index("ix_postal_complaints_external_order_no", "postal_complaints", ["external_order_no"], unique=False)
    op.create_index("ix_postal_complaints_status", "postal_complaints", ["status"], unique=False)


def downgrade() -> None:
    # drop_table 一并删表自身的索引与外键，无需（且在 MySQL 上不能）先删外键所依赖的索引。
    op.drop_table("postal_complaints")
