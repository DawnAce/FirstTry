"""来源交易转投历史。

Revision ID: b8d0f2a4c6e9
Revises: a7c9e1f3b5d8
"""
from alembic import op
import sqlalchemy as sa

revision = "b8d0f2a4c6e9"
down_revision = "a7c9e1f3b5d8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("order_sources", sa.Column("finance_review_required", sa.Boolean(), nullable=False, server_default="0"))
    op.add_column("order_source_links", sa.Column("refund_amount", sa.Numeric(10, 2), nullable=True))
    op.create_table("order_source_delivery_changes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source_id", sa.Integer(), sa.ForeignKey("order_sources.id"), nullable=False),
        sa.Column("link_id", sa.Integer(), sa.ForeignKey("order_source_links.id"), nullable=False),
        sa.Column("from_target_id", sa.Integer(), sa.ForeignKey("fulfillment_targets.id"), nullable=False),
        sa.Column("to_target_id", sa.Integer(), sa.ForeignKey("fulfillment_targets.id"), nullable=False),
        sa.Column("effective_from_issue", sa.Integer(), nullable=False),
        sa.Column("effective_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("previous_state", sa.JSON(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_order_source_delivery_changes_source_id", "order_source_delivery_changes", ["source_id"])


def downgrade() -> None:
    op.drop_table("order_source_delivery_changes")
    op.drop_column("order_source_links", "refund_amount")
    op.drop_column("order_sources", "finance_review_required")
