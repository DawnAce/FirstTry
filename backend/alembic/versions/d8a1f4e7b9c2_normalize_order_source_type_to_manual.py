"""normalize order.source_type to manual (PR-A entry method UX decoupling)

V1.1 阶段把 `orders.source_type` 的 UX 语义解耦为 "录入方式"（entry method）：
表单完全隐藏、详情页改用 Tag "📥 手工录入" 表达。原 5 个枚举值（ecommerce /
corporate_transfer / vip_gift / manual / mail_annual）实际混杂了 4 个维度的
概念，PR-A 先做数据规范化和 UI 解耦，PR-B 再做 schema rename 到 `entry_method`
+ 枚举值 `manual / excel_import / api_sync`。

当前 4 张订单全部为手工录入：
* ID 1,2,3: source_type='manual'           → 不变
* ID 4:     source_type='ecommerce'        → 改为 'manual'
            （source_platform='微信小程序' 等渠道信息已在专门字段里，无信息丢失）

Revision ID: d8a1f4e7b9c2
Revises: c7e3a9b1d2f4
Create Date: 2025-01-15 00:00:00.000000

"""
from alembic import op

# revision identifiers, used by Alembic.
revision = "d8a1f4e7b9c2"
down_revision = "c7e3a9b1d2f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Normalize all orders to entry_method='manual'.
    # 渠道/付款方式/业务性质 信息已由 source_platform / payment_method /
    # billing_type 等专门字段表达，source_type 不再承担多重职责。
    op.execute("UPDATE orders SET source_type = 'manual'")


def downgrade() -> None:
    # 数据规范化不可逆（原值丢失）。downgrade 仅作为 no-op 占位，
    # 以满足 alembic 双向迁移要求。
    pass
