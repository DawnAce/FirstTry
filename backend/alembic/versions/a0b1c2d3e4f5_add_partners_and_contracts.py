"""add partners (合作渠道) and contracts (渠道合同) tables

合同管理 v0：上游物流 / 发行 / 零售渠道的合同签署与归档。纯新增——不触动订单链路。
合同挂在 partner 下；扫描件落盘到 backend/uploads/contracts/，表里仅存相对路径 + 原始文件名。
预置 5 个已知合作渠道（中通 / 北京市报刊发行局 / 北京报刊零售局 / 成都邮征天下 / 广州日报）。

Revision ID: a0b1c2d3e4f5
Revises: c1d3f5a7b9e2
Create Date: 2026-06-30
"""

from alembic import op
import sqlalchemy as sa


revision = "a0b1c2d3e4f5"
down_revision = "c1d3f5a7b9e2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "partners",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column(
            "partner_type",
            sa.Enum(
                "logistics", "distribution", "retail", "other", name="partnertype"
            ),
            nullable=False,
        ),
        sa.Column("contact_person", sa.String(length=64), nullable=True),
        sa.Column("contact_phone", sa.String(length=64), nullable=True),
        sa.Column("settlement_account", sa.String(length=255), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("active", sa.Boolean(), server_default=sa.text("1"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_partners_name"),
    )

    op.create_table(
        "contracts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("partner_id", sa.Integer(), nullable=False),
        sa.Column("contract_no", sa.String(length=128), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("sign_year", sa.Integer(), nullable=True),
        sa.Column("sign_date", sa.Date(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column(
            "status",
            sa.Enum("active", "expired", "archived", "void", name="contractstatus"),
            server_default="active",
            nullable=False,
        ),
        sa.Column("attachment_filename", sa.String(length=255), nullable=True),
        sa.Column("attachment_path", sa.String(length=500), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["partner_id"], ["partners.id"], name="fk_contracts_partner"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], name="fk_contracts_created_by"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_contracts_partner_id", "contracts", ["partner_id"], unique=False)
    op.create_index("ix_contracts_contract_no", "contracts", ["contract_no"], unique=False)
    op.create_index("ix_contracts_sign_year", "contracts", ["sign_year"], unique=False)
    op.create_index("ix_contracts_status", "contracts", ["status"], unique=False)

    # 预置已知合作渠道（active / created_at / updated_at 走默认值）。
    partners = sa.table(
        "partners",
        sa.column("name", sa.String),
        sa.column("partner_type", sa.String),
    )
    op.bulk_insert(
        partners,
        [
            {"name": "中通", "partner_type": "logistics"},
            {"name": "北京市报刊发行局", "partner_type": "distribution"},
            {"name": "北京报刊零售局", "partner_type": "retail"},
            {"name": "成都邮征天下（成都杂志铺）", "partner_type": "distribution"},
            {"name": "广州日报", "partner_type": "other"},
        ],
    )


def downgrade() -> None:
    op.drop_index("ix_contracts_status", table_name="contracts")
    op.drop_index("ix_contracts_sign_year", table_name="contracts")
    op.drop_index("ix_contracts_contract_no", table_name="contracts")
    op.drop_index("ix_contracts_partner_id", table_name="contracts")
    op.drop_table("contracts")
    op.drop_table("partners")
