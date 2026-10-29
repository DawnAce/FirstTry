"""机构逐期订货／渠道报数；与个人零售订单分开，保留正式机构关联。"""
from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, JSON, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class ChannelDemand(Base):
    __tablename__ = "channel_demands"

    id = Column(Integer, primary_key=True, autoincrement=True)
    partner_id = Column(Integer, ForeignKey("partners.id"), nullable=False, index=True)
    contract_id = Column(Integer, ForeignKey("contracts.id"), nullable=True)
    display_name = Column(String(128), nullable=False)
    document_type = Column(String(20), nullable=False)
    cycle = Column(String(20), nullable=False)
    received_date = Column(Date, nullable=False)
    category = Column(String(50), nullable=False)
    status = Column(String(20), nullable=False, default="draft", server_default="draft", index=True)
    version = Column(Integer, nullable=False, default=1, server_default="1")
    supersedes_id = Column(Integer, ForeignKey("channel_demands.id"), nullable=True)
    transport = Column(String(20), nullable=False, default="pending", server_default="pending")
    recipient_name = Column(String(128), nullable=True)
    recipient_phone = Column(String(64), nullable=True)
    recipient_address = Column(String(500), nullable=True)
    pricing = Column(JSON, nullable=True)
    notes = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    confirmed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    confirmed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    partner = relationship("Partner")
    contract = relationship("Contract")
    lines = relationship("ChannelDemandLine", cascade="all, delete-orphan", order_by="ChannelDemandLine.id")
    attachments = relationship("ChannelDemandAttachment", cascade="all, delete-orphan", order_by="ChannelDemandAttachment.id")


class ChannelDemandLine(Base):
    __tablename__ = "channel_demand_lines"

    id = Column(Integer, primary_key=True, autoincrement=True)
    demand_id = Column(Integer, ForeignKey("channel_demands.id", ondelete="CASCADE"), nullable=False, index=True)
    issue_number = Column(Integer, nullable=False, index=True)
    publish_date = Column(Date, nullable=False)
    sub_category = Column(String(100), nullable=False)
    quantity = Column(Integer, nullable=True)
    review_status = Column(String(20), nullable=False)
    unit_price = Column(Numeric(10, 2), nullable=True)
    __table_args__ = (UniqueConstraint("demand_id", "issue_number", "sub_category", name="uq_demand_line_period"),)


class ChannelDemandAttachment(Base):
    __tablename__ = "channel_demand_attachments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    demand_id = Column(Integer, ForeignKey("channel_demands.id", ondelete="CASCADE"), nullable=False, index=True)
    filename = Column(String(255), nullable=False)
    stored_path = Column(String(500), nullable=False)
    sha256 = Column(String(64), nullable=False)
    extraction = Column(JSON, nullable=True)
    reviewed_version = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())


class ChannelDemandAdoption(Base):
    __tablename__ = "channel_demand_adoptions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    issue_number = Column(Integer, nullable=False, index=True)
    category = Column(String(50), nullable=False)
    sub_category = Column(String(100), nullable=False)
    quantity = Column(Integer, nullable=False)
    fingerprint = Column(String(64), nullable=False)
    apply_token = Column(String(64), nullable=False)
    source_snapshot = Column(JSON, nullable=False)
    adopted_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    adopted_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())
    __table_args__ = (UniqueConstraint("issue_number", "category", "sub_category", name="uq_demand_adoption_period"),)


class ChannelDemandProfile(Base):
    """稳定的机构业务映射；名称仅在迁移时用于识别既有档案。"""
    __tablename__ = "channel_demand_profiles"

    partner_id = Column(Integer, ForeignKey("partners.id"), primary_key=True)
    display_name = Column(String(128), nullable=False)
    category = Column(String(50), nullable=False)
    legal_name = Column(String(128), nullable=True)
    pricing_policy = Column(String(30), nullable=False, default="unpriced", server_default="unpriced")
