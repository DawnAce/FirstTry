"""add refunds table + orders.refunded_amount + refunded/cancelled event types

退款闭环（refund closed-loop）数据层：

* 新增 ``refunds`` 子表 —— 一笔退款一行（全额/部分），用 ``order_item_id`` /
  ``stop_from_issue`` 两个可选范围旋钮覆盖「纯退钱 / 退某商品 / 订阅中途退订」三种场景。
* ``orders.refunded_amount`` —— 已退累计金额（冗余 SUM(refunds.amount)），可空列加
  ``server_default='0'``，旧行干净升级；商业状态据它推（partial / full）。
* ``ordereventtype`` 枚举追加 ``refunded`` / ``cancelled``（退款 / 取消审计事件），
  追加到末尾以保持已有取值的 MySQL ENUM 索引不变。

Revision ID: f7a2c4e6b8d0
Revises: a3f1c8e2b5d9
Create Date: 2026-06-27
"""

from alembic import op
import sqlalchemy as sa


revision = "f7a2c4e6b8d0"
down_revision = "a3f1c8e2b5d9"
branch_labels = None
depends_on = None


# 迁移 b4d6f8a1c3e5 之后 ordereventtype 当前的 15 个取值（顺序、拼写需与库内完全一致，
# 漏写任何一个都会在 MySQL MODIFY 时把它从枚举里删掉）。
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
)

# 退款闭环新增的两个审计事件，追加到末尾。
_REFUND_EVENT_TYPES = ("refunded", "cancelled")

_NEW_EVENT_TYPES = _CURRENT_EVENT_TYPES + _REFUND_EVENT_TYPES

_CURRENT_ENUM = sa.Enum(*_CURRENT_EVENT_TYPES, name="ordereventtype")
_NEW_ENUM = sa.Enum(*_NEW_EVENT_TYPES, name="ordereventtype")


def upgrade() -> None:
    op.create_table(
        "refunds",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=False),
        sa.Column("order_item_id", sa.Integer(), nullable=True),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("stop_from_issue", sa.Integer(), nullable=True),
        sa.Column("refunded_at", sa.Date(), nullable=False),
        sa.Column("operator_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["order_item_id"], ["order_items.id"]),
        sa.ForeignKeyConstraint(["operator_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_refunds_order_id", "refunds", ["order_id"], unique=False)

    op.add_column(
        "orders",
        sa.Column(
            "refunded_amount",
            sa.Numeric(10, 2),
            server_default="0",
            nullable=False,
        ),
    )

    op.alter_column(
        "order_events",
        "event_type",
        existing_type=_CURRENT_ENUM,
        type_=_NEW_ENUM,
        existing_nullable=False,
    )


def downgrade() -> None:
    # 收回两个退款事件值前需先清理 order_events 中使用它们的行，否则 MySQL MODIFY
    # 严格模式报错 / 非严格模式截断为空串。
    op.alter_column(
        "order_events",
        "event_type",
        existing_type=_NEW_ENUM,
        type_=_CURRENT_ENUM,
        existing_nullable=False,
    )
    op.drop_column("orders", "refunded_amount")
    op.drop_index("ix_refunds_order_id", table_name="refunds")
    op.drop_table("refunds")
