import enum

from sqlalchemy import (
    Boolean,
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


class SettlementStatus(str, enum.Enum):
    pending = "pending"      # 待结算
    paid = "paid"            # 已打款
    invoiced = "invoiced"    # 已开票（拿到对方进项发票）
    archived = "archived"    # 已归档


class ChannelSettlement(Base):
    """渠道结算记录（与合作渠道按周期对账打款 + 进项发票归档）。

    挂在 ``partner`` 下（可选关联 ``contract``）。记录 应结 / 已打款 / 打款日 / 是否按时 /
    对方是否开票(进项)，结算单或进项发票扫描件经 ``attachment_service`` 落盘归档。
    复用模块二的 ``partners`` 主表，是上游「渠道侧」财务这条线。
    """

    __tablename__ = "channel_settlements"

    id = Column(Integer, primary_key=True, autoincrement=True)
    partner_id = Column(
        Integer,
        ForeignKey("partners.id"),
        nullable=False,
        index=True,
    )
    contract_id = Column(
        Integer,
        ForeignKey("contracts.id"),
        nullable=True,
        index=True,
    )
    period = Column(String(32), nullable=True, index=True)  # 结算周期，如 2026-Q1 / 2026-05
    amount_due = Column(Numeric(12, 2), nullable=True)        # 应结
    paid_amount = Column(Numeric(12, 2), nullable=True)       # 已打款
    paid_date = Column(Date, nullable=True)                   # 打款日
    on_time = Column(Boolean, nullable=True)                  # 是否按时
    invoice_received = Column(Boolean, default=False, nullable=False)  # 对方是否开票（进项）
    invoice_no = Column(String(64), nullable=True)            # 进项发票号
    status = Column(
        SAEnum(SettlementStatus),
        default=SettlementStatus.pending,
        nullable=False,
        index=True,
    )
    attachment_filename = Column(String(255), nullable=True)
    attachment_path = Column(String(500), nullable=True)
    notes = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    partner = relationship("Partner")
    contract = relationship("Contract")
