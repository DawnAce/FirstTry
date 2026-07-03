"""邮局投递 · 投诉工单（P2）。

《邮局年投诉》一行 = 一张投诉工单，挂在对应的邮局订单上：投诉的 ``编号``（"000680"）去零 +
``年度`` → ``f"{year}-{no}"`` 匹配 ``orders.external_order_no``；匹配到则 ``order_id``，匹配不上
仍保留 ``external_order_no`` 字符串以便回填。处理情况(转 XX 局 / 各地 11185)原文保留，另抽一个
``routed_label`` 归一键。状态按是否有回访派生。
"""

import enum

from sqlalchemy import (
    Column,
    Date,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.sql import func

from app.database import Base


class PostalComplaintStatus(str, enum.Enum):
    open = "open"          # 未回访 / 处理中
    resolved = "resolved"  # 已回访 / 已闭环


class PostalComplaint(Base):
    __tablename__ = "postal_complaints"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # 关联读者：按 (年度, 去零编号) 匹配投递记录 postal_delivery。
    postal_delivery_id = Column(
        Integer,
        ForeignKey("postal_delivery.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # 挂真实订单：仅当关联的投递记录自身挂了订单才继承（多数为空）。
    order_id = Column(
        Integer,
        ForeignKey("orders.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    external_order_no = Column(String(64), nullable=True, index=True)
    complaint_date = Column(Date, nullable=True)          # 接诉日期
    year = Column(Integer, nullable=True)                 # 年度
    missing_issues = Column(Text, nullable=True)          # 投诉情况（缺哪期，原文）
    handling = Column(Text, nullable=True)                # 处理情况（原文）
    routed_label = Column(String(64), nullable=True)      # 归一：\d*11185 热线 或 XX局
    routed_unit_id = Column(                              # 投递渠道单位 → partners.distribution
        Integer,
        ForeignKey("partners.id", ondelete="SET NULL"),
        nullable=True,
    )
    follow_up = Column(Text, nullable=True)               # 回访
    handling_count = Column(Integer, nullable=True)       # 处理次数
    status = Column(
        SAEnum(PostalComplaintStatus),
        default=PostalComplaintStatus.open,
        nullable=False,
        index=True,
    )
    first_handler = Column(String(64), nullable=True)     # 第一接诉人
    # 投诉时点快照（收报人当时联系方式，可能与订单不同）。
    snap_name = Column(String(128), nullable=True)
    snap_phone = Column(String(64), nullable=True)
    snap_address = Column(Text, nullable=True)
    snap_postal_code = Column(String(20), nullable=True)
    notes = Column(Text, nullable=True)                   # 备注
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
