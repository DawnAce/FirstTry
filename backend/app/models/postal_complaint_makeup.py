"""Complaint makeup shipments linked across postal tickets, orders and ZTO-MF."""

import enum

from sqlalchemy import Column, DateTime, Enum as SAEnum, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class PostalComplaintMakeupStatus(str, enum.Enum):
    ready = "ready"
    shipped = "shipped"
    completed = "completed"
    cancelled = "cancelled"


class PostalComplaintMakeupTask(Base):
    __tablename__ = "postal_complaint_makeup_tasks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    complaint_id = Column(Integer, ForeignKey("postal_tickets.id", ondelete="CASCADE"), nullable=False)
    order_id = Column(Integer, ForeignKey("orders.id", ondelete="SET NULL"), nullable=True)
    postal_delivery_id = Column(Integer, ForeignKey("postal_delivery.id", ondelete="SET NULL"), nullable=True)
    recipient_name = Column(String(128), nullable=False)
    recipient_phone = Column(String(64), nullable=True)
    recipient_address = Column(Text, nullable=False)
    status = Column(
        SAEnum(PostalComplaintMakeupStatus, name="postalcomplaintmakeupstatus"),
        nullable=False,
        default=PostalComplaintMakeupStatus.ready,
        server_default="ready",
    )
    tracking_no = Column(String(64), nullable=True)
    shipped_at = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    items = relationship(
        "PostalComplaintMakeupItem",
        back_populates="task",
        cascade="all, delete-orphan",
        order_by="PostalComplaintMakeupItem.issue_number",
    )

    __table_args__ = (
        Index("ix_makeup_task_complaint", "complaint_id"),
        Index("ix_makeup_task_order", "order_id"),
        Index("ix_makeup_task_delivery", "postal_delivery_id"),
        Index("ix_makeup_task_status", "status"),
    )


class PostalComplaintMakeupItem(Base):
    __tablename__ = "postal_complaint_makeup_items"

    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(
        Integer,
        ForeignKey("postal_complaint_makeup_tasks.id", ondelete="CASCADE"),
        nullable=False,
    )
    issue_number = Column(Integer, nullable=False)
    quantity = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    task = relationship("PostalComplaintMakeupTask", back_populates="items")
    shipping_detail = relationship(
        "ShippingDetail",
        primaryjoin="PostalComplaintMakeupItem.id == ShippingDetail.complaint_makeup_item_id",
        back_populates="complaint_makeup_item",
        uselist=False,
    )

    __table_args__ = (
        UniqueConstraint("task_id", "issue_number", name="uq_makeup_task_issue"),
        Index("ix_makeup_item_task", "task_id"),
        Index("ix_makeup_item_issue", "issue_number"),
    )
