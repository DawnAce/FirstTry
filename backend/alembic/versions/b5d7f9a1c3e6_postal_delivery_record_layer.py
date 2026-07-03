"""postal delivery record layer: postal_delivery table + postal_delivery_id links

重构：邮局从「造订单」改为「投递记录层」。新建 postal_delivery（投递记录，照
shipping_details 的可挂订单/可独立模型），并给 postal_delivery_rows / postal_complaints /
postal_address_changes / postal_follow_ups 各加 postal_delivery_id 溯源列（SET NULL）。

纯加表 / 加列，不动既有 FK，向后兼容。假订单的清理走单独的回填迁移（分环境）。

Revision ID: b5d7f9a1c3e6
Revises: a4c6e8b0d2f4
Create Date: 2026-07-03
"""

from alembic import op
import sqlalchemy as sa


revision = "b5d7f9a1c3e6"
down_revision = "a4c6e8b0d2f4"
branch_labels = None
depends_on = None


_LINK_TABLES = (
    "postal_delivery_rows",
    "postal_complaints",
    "postal_address_changes",
    "postal_follow_ups",
)


def upgrade() -> None:
    op.create_table(
        "postal_delivery",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("delivery_no", sa.String(length=64), nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=True),
        sa.Column("order_item_id", sa.Integer(), nullable=True),
        sa.Column("fulfillment_target_id", sa.Integer(), nullable=True),
        sa.Column("external_order_no", sa.String(length=128), nullable=True),
        sa.Column(
            "source_type",
            sa.Enum(
                "historical_import",
                "order_generated",
                "manual",
                name="postaldeliverysourcetype",
            ),
            server_default="historical_import",
            nullable=False,
        ),
        sa.Column("recipient_name", sa.String(length=128), nullable=False),
        sa.Column("recipient_phone", sa.String(length=64), nullable=True),
        sa.Column("recipient_province", sa.String(length=50), nullable=True),
        sa.Column("recipient_city", sa.String(length=50), nullable=True),
        sa.Column("recipient_district", sa.String(length=50), nullable=True),
        sa.Column("recipient_address", sa.Text(), nullable=False),
        sa.Column("recipient_postal_code", sa.String(length=20), nullable=True),
        sa.Column("product", sa.String(length=64), nullable=True),
        sa.Column("copies", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("amount", sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column("coverage_start_date", sa.Date(), nullable=True),
        sa.Column("coverage_end_date", sa.Date(), nullable=True),
        sa.Column("source_channel", sa.String(length=64), nullable=True),
        sa.Column("distribution_unit_id", sa.Integer(), nullable=True),
        sa.Column("salesperson", sa.String(length=64), nullable=True),
        sa.Column("remittance_name", sa.String(length=128), nullable=True),
        sa.Column("remittance_date", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["order_item_id"], ["order_items.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["fulfillment_target_id"], ["fulfillment_targets.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["distribution_unit_id"], ["partners.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("year", "delivery_no", name="uq_postal_delivery_year_no"),
    )
    op.create_index("ix_postal_delivery_year", "postal_delivery", ["year"])
    op.create_index("ix_postal_delivery_order_id", "postal_delivery", ["order_id"])
    op.create_index("ix_postal_delivery_external_order_no", "postal_delivery", ["external_order_no"])
    op.create_index("ix_postal_delivery_source_type", "postal_delivery", ["source_type"])
    op.create_index("ix_postal_delivery_coverage_start_date", "postal_delivery", ["coverage_start_date"])
    op.create_index("ix_postal_delivery_distribution_unit_id", "postal_delivery", ["distribution_unit_id"])

    # 给四张下游表加 postal_delivery_id（SET NULL）。
    for tbl in _LINK_TABLES:
        op.add_column(tbl, sa.Column("postal_delivery_id", sa.Integer(), nullable=True))
        op.create_index(f"ix_{tbl}_postal_delivery_id", tbl, ["postal_delivery_id"])
        op.create_foreign_key(
            f"fk_{tbl}_postal_delivery",
            tbl,
            "postal_delivery",
            ["postal_delivery_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    # 先摘掉四表的外键 + 索引 + 列（MySQL 下 FK 依赖顺序），再删主表。
    for tbl in _LINK_TABLES:
        op.drop_constraint(f"fk_{tbl}_postal_delivery", tbl, type_="foreignkey")
        op.drop_index(f"ix_{tbl}_postal_delivery_id", table_name=tbl)
        op.drop_column(tbl, "postal_delivery_id")
    # 主表：只 drop_table（自带删索引/FK/enum），别先 drop_index（踩坑记忆）。
    op.drop_table("postal_delivery")
