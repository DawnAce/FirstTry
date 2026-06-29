"""add payment_collections table + payment_recorded event type

欠款追踪（收款流水）数据层：

* 新增 ``payment_collections`` 子表 —— 一笔到账一行（对公/手工单分期），与退款台账
  ``refunds`` 对称；``orders.paid_amount`` 仍是冗余合计。
* ``ordereventtype`` 枚举追加 ``payment_recorded``（记一笔收款审计事件），追加到末尾
  以保持已有取值的 MySQL ENUM 索引不变。

Revision ID: c1d3f5a7b9e2
Revises: a9c3e5f70b21
Create Date: 2026-06-29
"""

from alembic import op
import sqlalchemy as sa


revision = "c1d3f5a7b9e2"
down_revision = "a9c3e5f70b21"
branch_labels = None
depends_on = None


# 迁移 f7a2c4e6b8d0 之后 ordereventtype 当前的 17 个取值（顺序、拼写需与库内完全一致）。
_CURRENT_EVENT_TYPES = (
    "created",
    "imported",
    "confirmed",
    "modified",
    "split",
    "voided",
    "allocation_updated",
    "target_added",
    "target_replaced",
    "target_suspended",
    "synced_to_shipping",
    "shipping_sync_conflict",
    "item_added",
    "item_removed",
    "item_modified",
    "refunded",
    "cancelled",
)

_NEW_EVENT_TYPES = _CURRENT_EVENT_TYPES + ("payment_recorded",)

_CURRENT_ENUM = sa.Enum(*_CURRENT_EVENT_TYPES, name="ordereventtype")
_NEW_ENUM = sa.Enum(*_NEW_EVENT_TYPES, name="ordereventtype")


def upgrade() -> None:
    op.create_table(
        "payment_collections",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("method", sa.String(length=32), nullable=True),
        sa.Column("collected_at", sa.Date(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("operator_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["operator_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_payment_collections_order_id", "payment_collections", ["order_id"], unique=False
    )

    op.alter_column(
        "order_events",
        "event_type",
        existing_type=_CURRENT_ENUM,
        type_=_NEW_ENUM,
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "order_events",
        "event_type",
        existing_type=_NEW_ENUM,
        type_=_CURRENT_ENUM,
        existing_nullable=False,
    )
    op.drop_index("ix_payment_collections_order_id", table_name="payment_collections")
    op.drop_table("payment_collections")
