"""postal_delivery: link to subscription batch + subscription_generated source

订报生成汇入投递名册：给 postal_delivery 加 subscription_batch_id（幂等替换用），
并给 source_type 枚举加 subscription_generated。纯加列/扩枚举，向后兼容。

Revision ID: b2c4d6e8f0a2
Revises: f1a2b3c4d5e6
Create Date: 2026-07-21
"""

from alembic import op
import sqlalchemy as sa


revision = "b2c4d6e8f0a2"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None

_OLD = ("historical_import", "order_generated", "manual")
_NEW = ("historical_import", "order_generated", "manual", "subscription_generated")


def upgrade() -> None:
    op.add_column(
        "postal_delivery",
        sa.Column("subscription_batch_id", sa.Integer(), nullable=True),
    )
    op.create_index(
        "ix_postal_delivery_subscription_batch_id", "postal_delivery", ["subscription_batch_id"]
    )
    op.create_foreign_key(
        "fk_postal_delivery_subscription_batch",
        "postal_delivery",
        "subscription_batches",
        ["subscription_batch_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.alter_column(
        "postal_delivery",
        "source_type",
        existing_type=sa.Enum(*_OLD, name="postaldeliverysourcetype"),
        type_=sa.Enum(*_NEW, name="postaldeliverysourcetype"),
        existing_nullable=False,
        existing_server_default="historical_import",
    )


def downgrade() -> None:
    op.alter_column(
        "postal_delivery",
        "source_type",
        existing_type=sa.Enum(*_NEW, name="postaldeliverysourcetype"),
        type_=sa.Enum(*_OLD, name="postaldeliverysourcetype"),
        existing_nullable=False,
        existing_server_default="historical_import",
    )
    op.drop_constraint("fk_postal_delivery_subscription_batch", "postal_delivery", type_="foreignkey")
    op.drop_index("ix_postal_delivery_subscription_batch_id", table_name="postal_delivery")
    op.drop_column("postal_delivery", "subscription_batch_id")
