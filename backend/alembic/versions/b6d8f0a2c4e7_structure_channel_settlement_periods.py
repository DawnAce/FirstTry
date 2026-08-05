"""structure channel settlement periods, invoice profiles and attachments

Revision ID: b6d8f0a2c4e7
Revises: a8c1e4f7b2d5
Create Date: 2026-08-05
"""

from alembic import op
import sqlalchemy as sa


revision = "b6d8f0a2c4e7"
down_revision = "a8c1e4f7b2d5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("partners", sa.Column("invoice_title", sa.String(255), nullable=True))
    op.add_column("partners", sa.Column("tax_no", sa.String(64), nullable=True))
    op.add_column("partners", sa.Column("taxpayer_type", sa.String(32), nullable=True))
    op.add_column("partners", sa.Column("default_invoice_type", sa.String(32), nullable=True))
    op.add_column("partners", sa.Column("default_tax_rate", sa.Numeric(5, 4), nullable=True))
    op.add_column("partners", sa.Column("default_invoice_content", sa.String(255), nullable=True))
    op.add_column("partners", sa.Column("default_invoice_unit", sa.String(32), nullable=True))
    op.add_column("partners", sa.Column("default_invoice_unit_price", sa.Numeric(12, 4), nullable=True))

    op.add_column(
        "channel_settlements",
        sa.Column(
            "direction",
            sa.Enum("receivable", "payable", name="settlementdirection"),
            server_default="payable",
            nullable=False,
        ),
    )
    op.add_column("channel_settlements", sa.Column("settlement_no", sa.String(64), nullable=True))
    op.add_column("channel_settlements", sa.Column("settlement_start_date", sa.Date(), nullable=True))
    op.add_column("channel_settlements", sa.Column("settlement_end_date", sa.Date(), nullable=True))
    op.add_column("channel_settlements", sa.Column("return_start_date", sa.Date(), nullable=True))
    op.add_column("channel_settlements", sa.Column("return_end_date", sa.Date(), nullable=True))
    op.add_column("channel_settlements", sa.Column("gross_amount", sa.Numeric(12, 2), nullable=True))
    op.add_column(
        "channel_settlements",
        sa.Column(
            "return_deduction_amount",
            sa.Numeric(12, 2),
            server_default="0",
            nullable=False,
        ),
    )
    op.add_column("channel_settlements", sa.Column("invoice_item_name", sa.String(255), nullable=True))
    op.add_column("channel_settlements", sa.Column("invoice_title", sa.String(255), nullable=True))
    op.add_column("channel_settlements", sa.Column("invoice_tax_no", sa.String(64), nullable=True))
    op.add_column("channel_settlements", sa.Column("invoice_taxpayer_type", sa.String(32), nullable=True))
    op.add_column("channel_settlements", sa.Column("invoice_type", sa.String(32), nullable=True))
    op.add_column("channel_settlements", sa.Column("invoice_unit", sa.String(32), nullable=True))
    op.add_column("channel_settlements", sa.Column("invoice_quantity", sa.Numeric(12, 2), nullable=True))
    op.add_column("channel_settlements", sa.Column("invoice_unit_price", sa.Numeric(12, 4), nullable=True))
    op.add_column("channel_settlements", sa.Column("invoice_tax_rate", sa.Numeric(5, 4), nullable=True))
    op.add_column("channel_settlements", sa.Column("invoice_amount", sa.Numeric(12, 2), nullable=True))
    op.create_index(
        "ux_settlements_settlement_no",
        "channel_settlements",
        ["settlement_no"],
        unique=True,
    )
    op.create_index(
        "ix_settlements_structured_period",
        "channel_settlements",
        ["settlement_start_date", "settlement_end_date"],
        unique=False,
    )

    op.create_table(
        "settlement_attachments",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("settlement_id", sa.Integer(), nullable=False),
        sa.Column(
            "category",
            sa.Enum(
                "settlement_sheet",
                "invoice_application",
                "invoice",
                "other",
                name="settlementattachmentcategory",
            ),
            server_default="other",
            nullable=False,
        ),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("path", sa.String(500), nullable=False),
        sa.Column("content_type", sa.String(128), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["settlement_id"],
            ["channel_settlements.id"],
            name="fk_settlement_attachments_settlement",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name="fk_settlement_attachments_created_by",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_settlement_attachments_settlement_id",
        "settlement_attachments",
        ["settlement_id"],
        unique=False,
    )

    # 旧版只有一个附件槽。复制进新表保留下载能力，旧列继续保留一个版本周期。
    op.execute(
        """
        INSERT INTO settlement_attachments
            (settlement_id, category, filename, path, content_type, created_by, created_at)
        SELECT id, 'other', attachment_filename, attachment_path, NULL, created_by, created_at
        FROM channel_settlements
        WHERE attachment_path IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_index("ix_settlement_attachments_settlement_id", table_name="settlement_attachments")
    op.drop_table("settlement_attachments")

    op.drop_index("ix_settlements_structured_period", table_name="channel_settlements")
    op.drop_index("ux_settlements_settlement_no", table_name="channel_settlements")
    for column in (
        "invoice_amount",
        "invoice_tax_rate",
        "invoice_unit_price",
        "invoice_quantity",
        "invoice_unit",
        "invoice_item_name",
        "invoice_type",
        "invoice_taxpayer_type",
        "invoice_tax_no",
        "invoice_title",
        "return_deduction_amount",
        "gross_amount",
        "return_end_date",
        "return_start_date",
        "settlement_end_date",
        "settlement_start_date",
        "settlement_no",
        "direction",
    ):
        op.drop_column("channel_settlements", column)

    for column in (
        "default_invoice_unit_price",
        "default_invoice_unit",
        "default_invoice_content",
        "default_tax_rate",
        "default_invoice_type",
        "taxpayer_type",
        "tax_no",
        "invoice_title",
    ):
        op.drop_column("partners", column)
