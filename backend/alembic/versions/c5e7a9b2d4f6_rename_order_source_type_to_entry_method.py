"""rename orders.source_type -> entry_method, converge enum (PR-B)

PR-B 完成「录入方式」字段的 schema 改名：把 orders.source_type（旧枚举
ecommerce/corporate_transfer/vip_gift/manual/mail_annual，混杂了 4 个不同维度的
概念）重命名为 entry_method，并把枚举收敛为 manual/excel_import/api_sync，分别对应
手工录入 / Excel 批量导入 / 第三方平台 API 同步三种数据进入系统的方式。

PR-A 的数据迁移 d8a1f4e7b9c2 已把所有订单规范化为 'manual'，因此本次无需回填——
'manual' 在新旧枚举里都存在，不会有越界值。MySQL 5.7 用 CHANGE COLUMN
（RENAME COLUMN 需 8.0+）；op.alter_column 同时给出 new_column_name + type_ 时即
渲染为单条 ALTER TABLE ... CHANGE。

复合索引 ix_orders_source_status_date 原引用 source_type；MySQL 在 CHANGE COLUMN
后会自动让该索引跟随重命名后的列，无需单独 drop/recreate。

注意：仅改订单的字段，shipping_details.source_type（ShippingDetailSourceType，
另一个独立枚举）不在本次范围内。

Revision ID: c5e7a9b2d4f6
Revises: b4d6f8a1c3e5
Create Date: 2026-06-20
"""

from alembic import op
import sqlalchemy as sa


revision = "c5e7a9b2d4f6"
down_revision = "b4d6f8a1c3e5"
branch_labels = None
depends_on = None


# 旧的 5 值枚举（建表迁移 c7e3a9b1d2f4 创建，PR-A 已把数据全部规范化为 manual）。
_OLD_ENUM = sa.Enum(
    "ecommerce",
    "corporate_transfer",
    "vip_gift",
    "manual",
    "mail_annual",
    name="ordersourcetype",
)

# 收敛后的录入方式枚举。
_NEW_ENUM = sa.Enum("manual", "excel_import", "api_sync", name="orderentrymethod")


def upgrade() -> None:
    # MySQL: ALTER TABLE orders CHANGE source_type entry_method
    #        ENUM('manual','excel_import','api_sync') NOT NULL
    op.alter_column(
        "orders",
        "source_type",
        new_column_name="entry_method",
        existing_type=_OLD_ENUM,
        type_=_NEW_ENUM,
        existing_nullable=False,
    )


def downgrade() -> None:
    # 改回旧列名与旧枚举。注意：若已存在 excel_import / api_sync 取值的行，需先
    # 清理/改写这些行，否则 MySQL CHANGE 会拒绝（严格模式）越界值。
    op.alter_column(
        "orders",
        "entry_method",
        new_column_name="source_type",
        existing_type=_NEW_ENUM,
        type_=_OLD_ENUM,
        existing_nullable=False,
    )
