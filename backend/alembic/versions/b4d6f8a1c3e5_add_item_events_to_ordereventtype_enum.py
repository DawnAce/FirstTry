"""add item_added/item_removed/item_modified to ordereventtype enum

修复 `order_events.event_type` 枚举漂移：模型 `OrderEventType` 自 V1.2 起就定义了
`item_added` / `item_removed` / `item_modified`，且 `order_service` 在编辑 active
订单明细时会实际写入这三种事件（PUT /orders/{id}/items）。但建表迁移
`c7e3a9b1d2f4` 创建 `ordereventtype` 时只列了 12 个值，遗漏了这三个，之后也没有任何
迁移补 ALTER。

后果：在 MySQL（生产库）上，任何对 active 订单明细的编辑写审计事件时枚举值非法——
严格模式直接报错（编辑失败 / 500），非严格模式静默写入空串、污染审计日志。单元测试
全绿只是因为测试用 SQLite + Base.metadata.create_all 按模型建表（不走 alembic），
正好把这个漂移掩盖了。

本迁移把缺失的三个值补进枚举。注意：MySQL 的 ENUM 在内部按索引存储，重排已有取值会
重映射历史数据，因此这里把新值 **追加到末尾**，保持原有 12 个值的索引不变。取值按
字符串匹配，枚举内顺序与模型 Python 声明顺序不一致不影响读写。

Revision ID: b4d6f8a1c3e5
Revises: a7c9e2f4b6d8
Create Date: 2026-06-19
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "b4d6f8a1c3e5"
down_revision = "a7c9e2f4b6d8"
branch_labels = None
depends_on = None


# 建表迁移 c7e3a9b1d2f4 中 ordereventtype 原有的 12 个取值（顺序、拼写需完全一致，
# 漏写任何一个都会在 MySQL MODIFY 时把它从枚举里删掉）。
_OLD_EVENT_TYPES = (
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
)

# 模型 OrderEventType 定义、order_service 实际发出但原枚举遗漏的三个值。
# 追加到末尾以保持已有取值的 MySQL ENUM 索引不变。
_ITEM_EVENT_TYPES = (
    "item_added",
    "item_removed",
    "item_modified",
)

_NEW_EVENT_TYPES = _OLD_EVENT_TYPES + _ITEM_EVENT_TYPES

_OLD_ENUM = sa.Enum(*_OLD_EVENT_TYPES, name="ordereventtype")
_NEW_ENUM = sa.Enum(*_NEW_EVENT_TYPES, name="ordereventtype")


def upgrade() -> None:
    # MySQL 上渲染为：ALTER TABLE order_events MODIFY event_type ENUM(...15...) NOT NULL
    op.alter_column(
        "order_events",
        "event_type",
        existing_type=_OLD_ENUM,
        type_=_NEW_ENUM,
        existing_nullable=False,
    )


def downgrade() -> None:
    # 收回三个 item_* 值。注意：若 order_events 已存在使用这三个值的行，需先清理/改写
    # 这些行，否则 MySQL MODIFY 会报错（严格模式）或将其截断为空串（非严格模式）。
    op.alter_column(
        "order_events",
        "event_type",
        existing_type=_NEW_ENUM,
        type_=_OLD_ENUM,
        existing_nullable=False,
    )
