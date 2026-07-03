"""邮局投递 · 投递记录 + 每月「起投月」明细批次（重构后）。

**邮局投递 = 一种投递方式，与中通 ZTO-MF 同级。** 数据来源于平台订单，但邮局明细本身是
**投递记录、不是订单**（照 ``shipping_details`` 的成熟模型）：

* ``PostalDelivery``      —— 一条投递记录（《邮局读者明细》一行）。``(year, delivery_no)``
  唯一；``order_id / order_item_id / fulfillment_target_id`` 全可空——该表只有内部「编号」、
  没有平台订单号，多数记录独立（你不负责的平台就是纯投递数据），将来有平台订单号且对得上
  才挂真实订单。与中通一样「可挂单 / 可独立」。
* ``PostalDeliveryBatch`` —— 某个起投月 ``(year, month)`` 的一版「月度起投明细」。
* ``PostalDeliveryRow``   —— 该版里冻结的一条投递明细（生成时定格当月快照），溯源
  ``postal_delivery_id``；即便事后改投递记录也不动已发批次。

月度明细：``batch(Y,M)`` 收集 ``coverage_start_date`` 落在该月的投递记录，冻结进本表。
"""

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
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class PostalDeliverySourceType(str, enum.Enum):
    """一条投递记录的来源（照 ``shipping_details`` 的 source_type）。

    * ``historical_import`` —— 导入《邮局读者明细》（默认）。
    * ``order_generated``   —— 将来：从真实平台订单同步生成。
    * ``manual``            —— 页面手工新增。
    """

    historical_import = "historical_import"
    order_generated = "order_generated"
    manual = "manual"


class PostalDelivery(Base):
    """邮局投递记录（投递层，与中通 ``shipping_details`` 同级，可挂订单 / 可独立）。"""

    __tablename__ = "postal_delivery"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # 身份 / 去重键：年度 + 编号（去前导零，如 "000680"→"680"）。
    year = Column(Integer, nullable=False, index=True)
    delivery_no = Column(String(64), nullable=False)
    # 挂真实订单：有平台订单号且是负责的平台才挂；SET NULL（订单删了记录仍在）。多数为空。
    order_id = Column(
        Integer,
        ForeignKey("orders.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    order_item_id = Column(
        Integer,
        ForeignKey("order_items.id", ondelete="SET NULL"),
        nullable=True,
    )
    fulfillment_target_id = Column(
        Integer,
        ForeignKey("fulfillment_targets.id", ondelete="SET NULL"),
        nullable=True,
    )
    external_order_no = Column(String(128), nullable=True, index=True)  # 平台订单号（将来补齐）
    source_type = Column(
        SAEnum(PostalDeliverySourceType, name="postaldeliverysourcetype"),
        default=PostalDeliverySourceType.historical_import,
        server_default="historical_import",
        nullable=False,
        index=True,
    )
    # 收报人。
    recipient_name = Column(String(128), nullable=False)
    recipient_phone = Column(String(64), nullable=True)
    recipient_province = Column(String(50), nullable=True)
    recipient_city = Column(String(50), nullable=True)
    recipient_district = Column(String(50), nullable=True)
    recipient_address = Column(Text, nullable=False)
    recipient_postal_code = Column(String(20), nullable=True)
    # 订阅信息。
    product = Column(String(64), nullable=True)                # 产品（认不出留原文，不强求枚举）
    copies = Column(Integer, default=1, nullable=False)        # 份数
    amount = Column(Numeric(10, 2), nullable=True)             # 金额
    coverage_start_date = Column(Date, nullable=True, index=True)  # 起投（归批依据）
    coverage_end_date = Column(Date, nullable=True)               # 止
    source_channel = Column(String(64), nullable=True)         # 渠道/平台（CBJ+小程序 等）
    # 投递单位（各地集订分送 → partners.distribution）；原表未填则留空、不推断。
    distribution_unit_id = Column(
        Integer,
        ForeignKey("partners.id"),
        nullable=True,
        index=True,
    )
    salesperson = Column(String(64), nullable=True)            # 业务员
    remittance_name = Column(String(128), nullable=True)       # 汇款名称（付款方）
    remittance_date = Column(Date, nullable=True)              # 汇款日期
    notes = Column(Text, nullable=True)                        # 备注（赠阅/关联等杂项）
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("year", "delivery_no", name="uq_postal_delivery_year_no"),
    )


class PostalBatchStatus(str, enum.Enum):
    """一版月度起投明细的生命周期。

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
    # 起投月：year+month 唯一确定一版。
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
    # 溯源到投递记录（投递记录删了置空、冻结快照仍在）。
    postal_delivery_id = Column(
        Integer,
        ForeignKey("postal_delivery.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # 溯源订单（投递记录挂了真实订单时带上；无则空）。
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
    # 冻结快照：生成时定格，之后改投递记录不影响本行。
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
