"""邮局投递 · 改地址工单 + 回访记录（P3）。

两者都按 编号 + 年度 关联投递记录 ``postal_delivery``（``postal_delivery_id`` 可空；关联的
投递记录若自身挂了真实订单则 ``order_id`` 一并继承）。
- ``PostalAddressChange`` = 一次改地址：记新旧身份 + 处理情况(转 XX 局微信) + 原/实际起月，
  可「应用新地址」把 new_* 写回投递记录（applied_to_order + 留痕）；无关联订单也能应用。
- ``PostalFollowUp`` = 一条回访，取代读者明细里「按天开列」的回访列（一格一条）。
"""

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.sql import func

from app.database import Base


class PostalAddressChange(Base):
    __tablename__ = "postal_address_changes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # 关联读者：按 编号 + 年度 匹配投递记录 postal_delivery。
    postal_delivery_id = Column(
        Integer,
        ForeignKey("postal_delivery.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    order_id = Column(
        Integer,
        ForeignKey("orders.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    external_order_no = Column(String(64), nullable=True, index=True)
    change_date = Column(Date, nullable=True)          # 修改日期
    # 原（快照）
    old_name = Column(String(128), nullable=True)
    old_phone = Column(String(64), nullable=True)
    old_address = Column(Text, nullable=True)
    old_copies = Column(Integer, nullable=True)
    # 新
    new_name = Column(String(128), nullable=True)
    new_phone = Column(String(64), nullable=True)
    new_address = Column(Text, nullable=True)
    new_copies = Column(Integer, nullable=True)          # 份数2
    original_start_month = Column(String(16), nullable=True)   # 原读者起月日
    effective_start_month = Column(String(16), nullable=True)  # 实际起月日
    handling = Column(String(128), nullable=True)        # 处理情况（转 XX 局微信）
    routed_label = Column(String(64), nullable=True)     # 归一：XX局
    # 应用新地址：把 new_* 写回投递记录（挂了真实订单则一并更新订单收报人）。
    applied_to_order = Column(Boolean, default=False, nullable=False)
    applied_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    applied_at = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )


class PostalFollowUp(Base):
    __tablename__ = "postal_follow_ups"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # 关联读者：按 编号 + 年度 匹配投递记录 postal_delivery。
    postal_delivery_id = Column(
        Integer,
        ForeignKey("postal_delivery.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    order_id = Column(
        Integer,
        ForeignKey("orders.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    external_order_no = Column(String(64), nullable=True, index=True)
    follow_up_date = Column(Date, nullable=True)    # 列头 "20240227回访" → 日期；"2025回访" → 空
    batch_label = Column(String(32), nullable=True)  # 列头原文
    result = Column(Text, nullable=True)             # 单元格值
    snap_name = Column(String(128), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )
