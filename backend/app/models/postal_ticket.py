"""邮局客服工单统一模型。

投诉、改地址和回访使用单表继承落在 ``postal_tickets``。类型专属字段保持可空，
公共关联、编号、年度和审计时间只存一份。投诉处理及并入投诉的回访统一写入
``postal_ticket_events`` 时间线。
"""

import enum

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship, synonym
from sqlalchemy.sql import func

from app.database import Base


class PostalTicketType(str, enum.Enum):
    complaint = "complaint"
    address = "address"
    follow = "follow"


class PostalComplaintStatus(str, enum.Enum):
    open = "open"
    in_progress = "in_progress"
    resolved = "resolved"


class PostalTicketEventType(str, enum.Enum):
    handling = "handling"
    follow_up = "follow_up"
    address_applied = "address_applied"


class PostalTicket(Base):
    __tablename__ = "postal_tickets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    type = Column(
        SAEnum(PostalTicketType, name="postaltickettype"),
        nullable=False,
        index=True,
    )
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
    year = Column(Integer, nullable=True, index=True)

    # 投诉字段。
    complaint_date = Column(Date, nullable=True)
    missing_issues = Column(Text, nullable=True)
    handling = Column(Text, nullable=True)
    routed_label = Column(String(64), nullable=True)
    routed_unit_id = Column(
        Integer,
        ForeignKey("partners.id", ondelete="SET NULL"),
        nullable=True,
    )
    follow_up = Column(Text, nullable=True)
    handling_count = Column(Integer, nullable=True)
    status = Column(
        SAEnum(PostalComplaintStatus, name="postalcomplaintstatus"),
        nullable=True,
        index=True,
    )
    first_handler = Column(String(64), nullable=True)
    snap_name = Column(String(128), nullable=True)
    snap_phone = Column(String(64), nullable=True)
    snap_address = Column(Text, nullable=True)
    snap_postal_code = Column(String(20), nullable=True)

    # 改地址字段。
    change_date = Column(DateTime, nullable=True)
    old_name = Column(String(128), nullable=True)
    old_phone = Column(String(64), nullable=True)
    old_address = Column(Text, nullable=True)
    old_copies = Column(Integer, nullable=True)
    new_name = Column(String(128), nullable=True)
    new_phone = Column(String(64), nullable=True)
    new_address = Column(Text, nullable=True)
    new_copies = Column(Integer, nullable=True)
    original_start_month = Column(String(16), nullable=True)
    effective_start_month = Column(String(16), nullable=True)
    applied_to_order = Column(Boolean, default=False, nullable=False)
    applied_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    applied_at = Column(DateTime, nullable=True)

    # 回访字段。
    follow_up_date = Column(Date, nullable=True)
    batch_label = Column(String(32), nullable=True)
    result = Column(Text, nullable=True)
    parent_ticket_id = Column(
        Integer,
        ForeignKey("postal_tickets.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    handlings = relationship(
        "PostalComplaintHandlingRecord",
        back_populates="complaint",
        foreign_keys="PostalComplaintHandlingRecord.ticket_id",
        cascade="all, delete-orphan",
        order_by=(
            "PostalComplaintHandlingRecord.handled_at.desc(), "
            "PostalComplaintHandlingRecord.id.desc()"
        ),
    )

    __mapper_args__ = {
        "polymorphic_on": type,
        "polymorphic_identity": "ticket",
    }


class PostalComplaint(PostalTicket):
    __mapper_args__ = {"polymorphic_identity": PostalTicketType.complaint}

    def __init__(self, **kwargs):
        kwargs.setdefault("status", PostalComplaintStatus.open)
        kwargs.setdefault("applied_to_order", False)
        super().__init__(**kwargs)


class PostalAddressChange(PostalTicket):
    __mapper_args__ = {"polymorphic_identity": PostalTicketType.address}

    def __init__(self, **kwargs):
        kwargs.setdefault("applied_to_order", False)
        super().__init__(**kwargs)


class PostalFollowUp(PostalTicket):
    __mapper_args__ = {"polymorphic_identity": PostalTicketType.follow}

    def __init__(self, **kwargs):
        kwargs.setdefault("applied_to_order", False)
        super().__init__(**kwargs)


class PostalComplaintHandlingRecord(Base):
    """统一工单时间线事件；类名保留以兼容既有投诉服务。"""

    __tablename__ = "postal_ticket_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    ticket_id = Column(
        Integer,
        ForeignKey("postal_tickets.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_ticket_id = Column(
        Integer,
        ForeignKey("postal_tickets.id", ondelete="SET NULL"),
        nullable=True,
        unique=True,
    )
    event_type = Column(
        SAEnum(PostalTicketEventType, name="postalticketeventtype"),
        default=PostalTicketEventType.handling,
        nullable=False,
        index=True,
    )
    handled_at = Column(DateTime, server_default=func.now(), nullable=False)
    handled_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    action = Column(Text, nullable=False)
    follow_result = Column(Text, nullable=True)
    result_status = Column(String(16), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    # 兼容旧服务和旧 API 字段名，物理列已经统一为 ticket_id。
    complaint_id = synonym("ticket_id")
    complaint = relationship(
        "PostalTicket",
        back_populates="handlings",
        foreign_keys=[ticket_id],
    )
