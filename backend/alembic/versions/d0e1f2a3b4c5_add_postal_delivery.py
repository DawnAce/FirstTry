"""add postal delivery batches + rows, distribution_unit on targets, seed 集订分送

邮局投递 P1：每月「起投月」批次 + 冻结明细行；给 fulfillment_targets 加 distribution_unit_id
（投递单位 → partners.distribution）；预置 7 个各地集订分送 Partner。纯新增，不触动既有链路。

Revision ID: d0e1f2a3b4c5
Revises: b1c2d3e4f5a6
Create Date: 2026-07-02
"""

from alembic import op
import sqlalchemy as sa


revision = "d0e1f2a3b4c5"
down_revision = "b1c2d3e4f5a6"
branch_labels = None
depends_on = None


# 各地集订分送（投递单位）——预置为 distribution 类型 Partner。
_POSTAL_UNITS = [
    "北京集订分送",
    "安徽集订分送",
    "广东集订分送",
    "江苏集订分送",
    "山东集订分送",
    "湖南集订分送",
    "内蒙集订分送",
]


def upgrade() -> None:
    # 1) fulfillment_targets 加投递单位外键列。
    op.add_column(
        "fulfillment_targets",
        sa.Column("distribution_unit_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_targets_distribution_unit",
        "fulfillment_targets",
        "partners",
        ["distribution_unit_id"],
        ["id"],
    )
    op.create_index(
        "ix_targets_distribution_unit",
        "fulfillment_targets",
        ["distribution_unit_id"],
        unique=False,
    )

    # 2) 每月起投批次。
    op.create_table(
        "postal_delivery_batches",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("draft", "generated", "sent", name="postalbatchstatus"),
            server_default="draft",
            nullable=False,
        ),
        sa.Column("generated_at", sa.DateTime(), nullable=True),
        sa.Column("sent_at", sa.DateTime(), nullable=True),
        sa.Column("row_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("year", "month", name="uq_postal_batch_year_month"),
    )
    op.create_index(
        "ix_postal_delivery_batches_status",
        "postal_delivery_batches",
        ["status"],
        unique=False,
    )

    # 3) 冻结明细行。
    op.create_table(
        "postal_delivery_rows",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("batch_id", sa.Integer(), nullable=False),
        sa.Column("order_item_id", sa.Integer(), nullable=True),
        sa.Column("fulfillment_target_id", sa.Integer(), nullable=True),
        sa.Column("snap_name", sa.String(length=128), nullable=False),
        sa.Column("snap_phone", sa.String(length=64), nullable=True),
        sa.Column("snap_province", sa.String(length=50), nullable=True),
        sa.Column("snap_city", sa.String(length=50), nullable=True),
        sa.Column("snap_district", sa.String(length=50), nullable=True),
        sa.Column("snap_address", sa.Text(), nullable=False),
        sa.Column("snap_postal_code", sa.String(length=20), nullable=True),
        sa.Column("copies", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("coverage_start_date", sa.Date(), nullable=True),
        sa.Column("coverage_end_date", sa.Date(), nullable=True),
        sa.Column("source_channel", sa.String(length=64), nullable=True),
        sa.Column("distribution_unit_id", sa.Integer(), nullable=True),
        sa.Column("salesperson", sa.String(length=64), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["batch_id"], ["postal_delivery_batches.id"],
            name="fk_postal_rows_batch", ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["order_item_id"], ["order_items.id"],
            name="fk_postal_rows_order_item", ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["fulfillment_target_id"], ["fulfillment_targets.id"],
            name="fk_postal_rows_target", ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["distribution_unit_id"], ["partners.id"],
            name="fk_postal_rows_distribution_unit",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_postal_delivery_rows_batch_id",
        "postal_delivery_rows",
        ["batch_id"],
        unique=False,
    )
    op.create_index(
        "ix_postal_delivery_rows_order_item_id",
        "postal_delivery_rows",
        ["order_item_id"],
        unique=False,
    )

    # 4) 预置各地集订分送（投递单位）。已存在则跳过（幂等）。
    partners = sa.table(
        "partners",
        sa.column("name", sa.String),
        sa.column("partner_type", sa.String),
    )
    conn = op.get_bind()
    existing = {
        row[0]
        for row in conn.execute(sa.text("SELECT name FROM partners")).fetchall()
    }
    to_add = [
        {"name": name, "partner_type": "distribution"}
        for name in _POSTAL_UNITS
        if name not in existing
    ]
    if to_add:
        op.bulk_insert(partners, to_add)


def downgrade() -> None:
    # 先删引用 partners 的对象（批次行 / 履约目标外键列），最后再删预置的集订分送 Partner——
    # 否则库里已有邮局数据时，DELETE partners 会被外键 RESTRICT 拒绝、回滚失败。
    # drop_table 会一并删掉表自身的索引与外键约束，无需（且在 MySQL 上不能）先删外键所依赖的索引。
    op.drop_table("postal_delivery_rows")
    op.drop_table("postal_delivery_batches")

    # fulfillment_targets：先删外键、再删它所依赖的索引，最后删列。
    op.drop_constraint("fk_targets_distribution_unit", "fulfillment_targets", type_="foreignkey")
    op.drop_index("ix_targets_distribution_unit", table_name="fulfillment_targets")
    op.drop_column("fulfillment_targets", "distribution_unit_id")

    conn = op.get_bind()
    conn.execute(
        sa.text("DELETE FROM partners WHERE name IN :names").bindparams(
            sa.bindparam("names", value=tuple(_POSTAL_UNITS), expanding=True)
        )
    )
