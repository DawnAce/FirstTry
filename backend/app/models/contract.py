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


class ContractStatus(str, enum.Enum):
    """合同状态（手工维护；列表另按 end_date 派生「快到期」提示，不改状态）。"""

    active = "active"      # 生效
    expired = "expired"    # 到期
    archived = "archived"  # 已归档
    void = "void"          # 作废


class Contract(Base):
    """渠道合同（与中通 / 报刊发行局等合作方的年度合同签署 + 归档记录）。

    主要用途：记录每年合同的签署与扫描件归档，挂在 ``partner`` 下。状态手工维护；
    ``start_date`` / ``end_date`` 供列表「快到期」提示。扫描件经 ``attachment_service``
    落盘，``attachment_path`` 存相对路径、``attachment_filename`` 存原始文件名，
    下载走鉴权接口流式返回（不静态暴露——合同属敏感件）。
    """

    __tablename__ = "contracts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    partner_id = Column(
        Integer,
        ForeignKey("partners.id"),
        nullable=False,
        index=True,
    )
    contract_no = Column(String(128), nullable=True, index=True)
    title = Column(String(255), nullable=False)
    sign_year = Column(Integer, nullable=True, index=True)
    sign_date = Column(Date, nullable=True)
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    amount = Column(Numeric(12, 2), nullable=True)
    status = Column(
        SAEnum(ContractStatus),
        default=ContractStatus.active,
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
