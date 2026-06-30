"""退款台账 (refunds) —— 一笔退款一行（全额或部分）。

一个统一的表形状用两个可选「作用范围」旋钮覆盖三种真实的部分退款场景：

* ``order_item_id`` 空 + ``stop_from_issue`` 空 → 纯退钱、履约不变（让利/补偿）
* ``order_item_id`` 有值                        → 退的是该条明细（多商品单退掉其一）
* ``stop_from_issue`` 有值                       → 该明细从该期起停发（订阅中途退订）

订单的 ``commercial_status`` 与 ``refunded_amount`` 在记一笔退款时由
``order_service`` 推导 / 维护，不在本表算。
"""

from sqlalchemy import (
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class Refund(Base):
    __tablename__ = "refunds"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(
        Integer,
        ForeignKey("orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # 退的是哪条明细（场景②③）；空 = 订单级退款（场景① / 全额退）。
    order_item_id = Column(Integer, ForeignKey("order_items.id"), nullable=True)
    amount = Column(Numeric(10, 2), nullable=False)
    reason = Column(Text, nullable=True)
    # 从该期起停发（场景③订阅中途退订）；空 = 不按期切（场景①纯退钱 / 场景②立即停该明细）。
    stop_from_issue = Column(Integer, nullable=True)
    # 退款业务日期（默认记账当天）；与 created_at（系统写入时刻）区分。
    refunded_at = Column(Date, nullable=False)
    operator_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    order = relationship("Order", back_populates="refunds")
