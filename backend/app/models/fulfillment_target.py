import enum

from sqlalchemy import (
    Column,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class ShippingChannel(str, enum.Enum):
    zto_outsource = "zto_outsource"
    post_office = "post_office"   # V2 hook
    self_sf = "self_sf"           # V2 hook
    other = "other"               # V2 hook


class TargetStatus(str, enum.Enum):
    active = "active"
    suspended = "suspended"
    replaced = "replaced"


class FulfillmentTarget(Base):
    """A concrete shipping target inside an allocation version.

    Each row produces one row per applicable issue in shipping_details
    when synced to ZTO-MF. The effective_from_issue / effective_until_issue
    range allows mid-period recipient swaps without creating a whole new
    allocation version (used for single-target add/swap inside the current
    version per design Scenario B).
    """

    __tablename__ = "fulfillment_targets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_item_id = Column(
        Integer,
        ForeignKey("order_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    allocation_id = Column(
        Integer,
        ForeignKey("fulfillment_allocations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    recipient_name = Column(String(128), nullable=False)
    recipient_phone = Column(String(64), nullable=True)
    recipient_address = Column(Text, nullable=False)
    recipient_postal_code = Column(String(20), nullable=True)
    quantity = Column(Integer, default=1, nullable=False)
    shipping_channel = Column(
        SAEnum(ShippingChannel),
        nullable=False,
        default=ShippingChannel.zto_outsource,
    )
    effective_from_issue = Column(Integer, nullable=True)
    effective_until_issue = Column(Integer, nullable=True)
    status = Column(
        SAEnum(TargetStatus),
        default=TargetStatus.active,
        nullable=False,
    )
    # V2 hook: when a target is replaced by another, the new target's id
    # is recorded here so we can walk the replacement chain.
    replaced_by_target_id = Column(
        Integer,
        ForeignKey("fulfillment_targets.id"),
        nullable=True,
    )
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    order_item = relationship("OrderItem", back_populates="targets")
    allocation = relationship("FulfillmentAllocation", back_populates="targets")

    __table_args__ = (
        Index(
            "ix_targets_eff_status",
            "effective_from_issue",
            "effective_until_issue",
            "status",
        ),
    )
