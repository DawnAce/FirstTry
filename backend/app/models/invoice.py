import enum

from sqlalchemy import (
    Column,
    Date,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class InvoiceType(str, enum.Enum):
    normal = "normal"              # 正票
    red_reversal = "red_reversal"  # 红冲（退款冲红）


class Invoice(Base):
    """订单发票登记（开票 + 退款冲红追踪）。

    只做登记 / 追踪，不生成发票文件。一张订单通常一条 ``normal``；发生退款且已开票时再登记一条
    ``red_reversal`` 表示冲红。某订单「是否需要冲红」由 ``finance_service`` 推导
    （已有 normal + ``order.refunded_amount`` > 0 + 尚无 red_reversal），不存字段。
    """

    __tablename__ = "invoices"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(
        Integer,
        ForeignKey("orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    invoice_type = Column(
        SAEnum(InvoiceType),
        nullable=False,
        default=InvoiceType.normal,
    )
    invoice_no = Column(String(64), nullable=True, index=True)
    amount = Column(Numeric(10, 2), nullable=True)
    issued_date = Column(Date, nullable=True)
    buyer_title = Column(Text, nullable=True)   # 开票抬头
    tax_no = Column(String(64), nullable=True)  # 税号
    notes = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    order = relationship("Order")
