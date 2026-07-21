"""drop postal monthly-snapshot layer (batches + rows)

邮局管理重构 PR-B：删除「月度起投明细 / 月度快照 / 起投批次」层。
给邮局的名单只来自「邮局订报生成」，快照属重复劳动，整层移除。

⚠️ 生产执行前：先用 scripts/export_postal_snapshot.py 导出
postal_delivery_batches / postal_delivery_rows 为 json 归档。

Revision ID: c3d5e7f9a1b3
Revises: b2c4d6e8f0a2
Create Date: 2026-07-21
"""

from alembic import op
import sqlalchemy as sa


revision = "c3d5e7f9a1b3"
down_revision = "b2c4d6e8f0a2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 先删子表 rows（FK 依赖 batches），再删 batches。
    # drop_table 会一并删掉表自身的索引与外键约束，无需（且在 MySQL 上不能）先删外键所依赖的索引。
    op.drop_table("postal_delivery_rows")
    op.drop_table("postal_delivery_batches")


def downgrade() -> None:
    # 重建两表（与原 d0e1f2a3b4c5 创建定义一致），batches 先于 rows。
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
    op.create_table(
        "postal_delivery_rows",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("batch_id", sa.Integer(), nullable=False),
        sa.Column("postal_delivery_id", sa.Integer(), nullable=True),
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
            ["postal_delivery_id"], ["postal_delivery.id"],
            name="fk_postal_rows_delivery", ondelete="SET NULL",
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
    op.create_index(
        "ix_postal_delivery_rows_postal_delivery_id",
        "postal_delivery_rows",
        ["postal_delivery_id"],
        unique=False,
    )
