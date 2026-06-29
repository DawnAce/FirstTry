"""收款流水 (payment_collections) —— 一笔到账一行。

对公 / 手工单常分期到账：每笔收款记一行（金额 / 到账日 / 方式 / 经办人），
``orders.paid_amount`` 是冗余合计（``record_payment`` 累加维护）。与退款台账
``refunds`` 对称。电商单导入时 paid_amount 一次性设满、不建流水行。
"""

from sqlalchemy import (
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class Payment(Base):
    __tablename__ = "payment_collections"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(
        Integer,
        ForeignKey("orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    amount = Column(Numeric(10, 2), nullable=False)
    # 收款方式（微信/支付宝/对公转账/现金…）；自由串，不与订单级 payment_method 枚举耦合。
    method = Column(String(32), nullable=True)
    # 到账业务日期（默认记账当天）；与 created_at（系统写入时刻）区分。
    collected_at = Column(Date, nullable=False)
    notes = Column(Text, nullable=True)
    operator_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    order = relationship("Order", back_populates="payments")
