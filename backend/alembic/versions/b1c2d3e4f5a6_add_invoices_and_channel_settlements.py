"""add invoices (订单发票) and channel_settlements (渠道结算) tables

财务管理 v0：① 订单发票登记 + 退款冲红；② 渠道结算（与合作渠道对账打款 + 进项发票归档）。
纯新增——不触动订单 / 合同链路。invoices 挂订单；channel_settlements 复用模块二 partners(+可选 contracts)。
结算附件落 backend/uploads/settlements/，表里仅存相对路径 + 原始文件名。

Revision ID: b1c2d3e4f5a6
Revises: a0b1c2d3e4f5
Create Date: 2026-06-30
"""

from alembic import op
import sqlalchemy as sa


revision = "b1c2d3e4f5a6"
down_revision = "a0b1c2d3e4f5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "invoices",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=False),
        sa.Column(
            "invoice_type",
            sa.Enum("normal", "red_reversal", name="invoicetype"),
            server_default="normal",
            nullable=False,
        ),
        sa.Column("invoice_no", sa.String(length=64), nullable=True),
        sa.Column("amount", sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column("issued_date", sa.Date(), nullable=True),
        sa.Column("buyer_title", sa.Text(), nullable=True),
        sa.Column("tax_no", sa.String(length=64), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], name="fk_invoices_order", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], name="fk_invoices_created_by"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_invoices_order_id", "invoices", ["order_id"], unique=False)
    op.create_index("ix_invoices_invoice_no", "invoices", ["invoice_no"], unique=False)

    op.create_table(
        "channel_settlements",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("partner_id", sa.Integer(), nullable=False),
        sa.Column("contract_id", sa.Integer(), nullable=True),
        sa.Column("period", sa.String(length=32), nullable=True),
        sa.Column("amount_due", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("paid_amount", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("paid_date", sa.Date(), nullable=True),
        sa.Column("on_time", sa.Boolean(), nullable=True),
        sa.Column("invoice_received", sa.Boolean(), server_default=sa.text("0"), nullable=False),
        sa.Column("invoice_no", sa.String(length=64), nullable=True),
        sa.Column(
            "status",
            sa.Enum("pending", "paid", "invoiced", "archived", name="settlementstatus"),
            server_default="pending",
            nullable=False,
        ),
        sa.Column("attachment_filename", sa.String(length=255), nullable=True),
        sa.Column("attachment_path", sa.String(length=500), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["partner_id"], ["partners.id"], name="fk_settlements_partner"),
        sa.ForeignKeyConstraint(["contract_id"], ["contracts.id"], name="fk_settlements_contract"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], name="fk_settlements_created_by"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_settlements_partner_id", "channel_settlements", ["partner_id"], unique=False)
    op.create_index("ix_settlements_contract_id", "channel_settlements", ["contract_id"], unique=False)
    op.create_index("ix_settlements_period", "channel_settlements", ["period"], unique=False)
    op.create_index("ix_settlements_status", "channel_settlements", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_settlements_status", table_name="channel_settlements")
    op.drop_index("ix_settlements_period", table_name="channel_settlements")
    op.drop_index("ix_settlements_contract_id", table_name="channel_settlements")
    op.drop_index("ix_settlements_partner_id", table_name="channel_settlements")
    op.drop_table("channel_settlements")
    op.drop_index("ix_invoices_invoice_no", table_name="invoices")
    op.drop_index("ix_invoices_order_id", table_name="invoices")
    op.drop_table("invoices")
