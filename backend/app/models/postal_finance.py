"""邮局投递 · 收款 / 发票（提现发票合集，P4）。

《提现发票合集》一行 = 一条收款+开票记录。挂订单：**优先原始平台订单号**（将来补，精确匹配
``orders.external_order_no``）、**姓名兜底**（唯一命中才挂）。``link_by`` 记录链接来源。
本表自成台账，不改共享财务模块；等订单号可靠后再单独并进财务发票工作台。
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
from sqlalchemy.sql import func

from app.database import Base


class PostalFinance(Base):
    __tablename__ = "postal_finance"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(
        Integer,
        ForeignKey("orders.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    external_order_no = Column(String(128), nullable=True, index=True)  # 原始平台订单号
    link_by = Column(String(16), nullable=True)   # order_no | name | none
    payer_name = Column(String(128), nullable=True, index=True)  # 姓名
    product = Column(String(128), nullable=True)  # 商品名称
    copies = Column(Integer, nullable=True)       # 份数
    amount = Column(Numeric(10, 2), nullable=True)          # 金额（应收）
    fee_amount = Column(Numeric(10, 2), nullable=True)      # 手续费
    net_amount = Column(Numeric(10, 2), nullable=True)      # 到款金额
    collected_at = Column(Date, nullable=True)             # 到款日期
    invoiced_amount = Column(Numeric(10, 2), nullable=True)  # 开票金额
    buyer_title = Column(Text, nullable=True)     # 发票抬头
    tax_no = Column(String(64), nullable=True)    # 购方税号
    invoice_recipient = Column(String(128), nullable=True)  # 发票接收手机/邮箱
    tax_category = Column(String(16), nullable=True)  # 普票 | 专票
    platform = Column(String(64), nullable=True)  # 订单平台
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )
