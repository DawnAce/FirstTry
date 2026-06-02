import enum

from sqlalchemy import (
    Column,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    JSON,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class OrderEventType(str, enum.Enum):
    created = "created"
    imported = "imported"                       # V2 batch import
    confirmed = "confirmed"
    modified = "modified"
    split = "split"
    voided = "voided"
    allocation_updated = "allocation_updated"
    target_added = "target_added"
    target_replaced = "target_replaced"
    target_suspended = "target_suspended"
    synced_to_shipping = "synced_to_shipping"           # V1.3
    shipping_sync_conflict = "shipping_sync_conflict"   # V1.3


class OrderEvent(Base):
    """Append-only audit log of order lifecycle and allocation changes.

    payload_json stores event-specific data, for example:
      - confirmed: {"order_code": "ORD-2026-000123"}
      - allocation_updated: {"from_version": 1, "to_version": 2, "reason": "..."}
      - synced_to_shipping: {"issue_number": 2655, "rows_written": 8}
    """

    __tablename__ = "order_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(
        Integer,
        ForeignKey("orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_type = Column(SAEnum(OrderEventType), nullable=False, index=True)
    payload_json = Column(JSON, nullable=True)
    operator_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(
        DateTime,
        server_default=func.now(),
        nullable=False,
        index=True,
    )

    order = relationship("Order", back_populates="events")
