"""平台原始交易、版本、订阅关联及审计。

Revision ID: a7c9e1f3b5d8
Revises: f2c4e6a8b0d3
"""
from alembic import op
import sqlalchemy as sa

revision = "a7c9e1f3b5d8"
down_revision = "f2c4e6a8b0d3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("order_sources",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("platform", sa.String(64), nullable=False),
        sa.Column("store", sa.String(128), nullable=False),
        sa.Column("external_order_no", sa.String(128), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("lock_version", sa.Integer(), nullable=False),
        sa.Column("order_date", sa.Date()),
        sa.Column("recipient_name", sa.String(128), nullable=False),
        sa.Column("recipient_phone", sa.String(64), nullable=False),
        sa.Column("recipient_address", sa.Text(), nullable=False),
        sa.Column("commercial_status", sa.String(32)),
        sa.Column("paid_amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("verified_refund_amount", sa.Numeric(10, 2)),
        sa.Column("verified_refund_date", sa.Date()),
        sa.Column("finance_note", sa.Text()),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("platform", "store", "external_order_no", name="uq_order_source_identity"))
    for field in ("external_order_no", "order_date", "recipient_name", "recipient_phone"):
        op.create_index(f"ix_order_sources_{field}", "order_sources", [field])
    op.create_table("order_source_versions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source_id", sa.Integer(), sa.ForeignKey("order_sources.id"), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("search_text", sa.Text(), nullable=False),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("source_id", "revision", name="uq_order_source_revision"))
    op.create_index("ix_order_source_versions_source_id", "order_source_versions", ["source_id"])
    op.create_table("order_source_links",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source_id", sa.Integer(), sa.ForeignKey("order_sources.id"), nullable=False),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("order_item_id", sa.Integer(), sa.ForeignKey("order_items.id")),
        sa.Column("target_id", sa.Integer(), sa.ForeignKey("fulfillment_targets.id")),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("active", sa.Integer(), nullable=False),
        sa.Column("delivery_from_issue", sa.Integer()),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False))
    for field in ("source_id", "order_id"):
        op.create_index(f"ix_order_source_links_{field}", "order_source_links", [field])
    op.create_table("order_source_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source_id", sa.Integer(), sa.ForeignKey("order_sources.id"), nullable=False),
        sa.Column("action", sa.String(48), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("operator_id", sa.Integer(), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False))
    op.create_index("ix_order_source_events_source_id", "order_source_events", ["source_id"])


def downgrade() -> None:
    for table in ("order_source_events", "order_source_links", "order_source_versions", "order_sources"):
        op.drop_table(table)
