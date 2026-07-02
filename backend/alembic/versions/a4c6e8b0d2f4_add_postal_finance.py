"""add postal_finance (邮局收款/发票 提现发票合集)

邮局投递 P4。纯新增一表，挂订单(order_id 可空 SET NULL)。不改共享财务模块。

Revision ID: a4c6e8b0d2f4
Revises: f3a5c7b9d1e2
Create Date: 2026-07-02
"""

from alembic import op
import sqlalchemy as sa


revision = "a4c6e8b0d2f4"
down_revision = "f3a5c7b9d1e2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "postal_finance",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=True),
        sa.Column("external_order_no", sa.String(length=128), nullable=True),
        sa.Column("link_by", sa.String(length=16), nullable=True),
        sa.Column("payer_name", sa.String(length=128), nullable=True),
        sa.Column("product", sa.String(length=128), nullable=True),
        sa.Column("copies", sa.Integer(), nullable=True),
        sa.Column("amount", sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column("fee_amount", sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column("net_amount", sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column("collected_at", sa.Date(), nullable=True),
        sa.Column("invoiced_amount", sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column("buyer_title", sa.Text(), nullable=True),
        sa.Column("tax_no", sa.String(length=64), nullable=True),
        sa.Column("invoice_recipient", sa.String(length=128), nullable=True),
        sa.Column("tax_category", sa.String(length=16), nullable=True),
        sa.Column("platform", sa.String(length=64), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], name="fk_postal_finance_order", ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_postal_finance_order_id", "postal_finance", ["order_id"], unique=False)
    op.create_index("ix_postal_finance_external_order_no", "postal_finance", ["external_order_no"], unique=False)
    op.create_index("ix_postal_finance_payer_name", "postal_finance", ["payer_name"], unique=False)


def downgrade() -> None:
    op.drop_table("postal_finance")
