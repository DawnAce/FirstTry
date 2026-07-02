"""邮局投递 · 每月「起投月」批次 + 冻结明细行（P1）。

邮局投递不走中通那条按刊期的发货明细：每月只给邮局一版「当月起投」的新明细。
``PostalDeliveryBatch`` = 某个起投月(year, month)的一版批次；``PostalDeliveryRow`` =
该版里的一条投递明细，生成时**冻结当月快照**（收报人/地址/份数/起止/投递单位），
即便事后改了订单也不动已发批次——对应「3 月给邮局的就是这些人」。

数据来源是 post_office 订单：``batch(Y,M)`` 收集 ``delivery_method=post_office`` 且
``month(coverage_start_date)==(Y,M)`` 的在效明细，冻结进本表。溯源保留 order_item_id /
fulfillment_target_id（订单被删则置空、快照仍在）。
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
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class PostalBatchStatus(str, enum.Enum):
    """一版批次的生命周期。

    * ``draft``     —— 占位/待生成（尚未冻结明细）。
    * ``generated`` —— 已按起投月归批并冻结明细，待导出/发出。
    * ``sent``      —— 已导出交邮局；此后**冻结不可再生成**（内容定格）。
    """

    draft = "draft"
    generated = "generated"
    sent = "sent"


class PostalDeliveryBatch(Base):
    __tablename__ = "postal_delivery_batches"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # 起投月：year+month 唯一确定一版批次。
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False)
    status = Column(
        SAEnum(PostalBatchStatus),
        default=PostalBatchStatus.draft,
        nullable=False,
        index=True,
    )
    generated_at = Column(DateTime, nullable=True)
    sent_at = Column(DateTime, nullable=True)
    row_count = Column(Integer, default=0, nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    rows = relationship(
        "PostalDeliveryRow",
        back_populates="batch",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint("year", "month", name="uq_postal_batch_year_month"),
    )


class PostalDeliveryRow(Base):
    __tablename__ = "postal_delivery_rows"

    id = Column(Integer, primary_key=True, autoincrement=True)
    batch_id = Column(
        Integer,
        ForeignKey("postal_delivery_batches.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # 溯源（订单硬删则置空，冻结快照仍保留）。
    order_item_id = Column(
        Integer,
        ForeignKey("order_items.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    fulfillment_target_id = Column(
        Integer,
        ForeignKey("fulfillment_targets.id", ondelete="SET NULL"),
        nullable=True,
    )
    # 冻结快照：生成时定格，之后改订单不影响本行。
    snap_name = Column(String(128), nullable=False)
    snap_phone = Column(String(64), nullable=True)
    snap_province = Column(String(50), nullable=True)
    snap_city = Column(String(50), nullable=True)
    snap_district = Column(String(50), nullable=True)
    snap_address = Column(Text, nullable=False)
    snap_postal_code = Column(String(20), nullable=True)
    copies = Column(Integer, default=1, nullable=False)
    coverage_start_date = Column(Date, nullable=True)
    coverage_end_date = Column(Date, nullable=True)
    source_channel = Column(String(64), nullable=True)
    # 投递单位（各地集订分送 → partners.distribution）；原表未填则留空、不推断。
    distribution_unit_id = Column(
        Integer,
        ForeignKey("partners.id"),
        nullable=True,
    )
    salesperson = Column(String(64), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    batch = relationship("PostalDeliveryBatch", back_populates="rows")
