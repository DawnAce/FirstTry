from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class FulfillmentAllocation(Base):
    """A versioned snapshot of how an order item is split among recipients.

    Whenever the recipient list / quantity split changes meaningfully,
    a new version (version_no = previous + 1) is created instead of
    mutating the existing row, so history is preserved for audit and
    for ZTO sync to always know the active configuration at a given
    issue number.
    """

    __tablename__ = "fulfillment_allocations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_item_id = Column(
        Integer,
        ForeignKey("order_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version_no = Column(Integer, nullable=False)
    effective_from_issue = Column(Integer, nullable=True)
    effective_until_issue = Column(Integer, nullable=True)
    change_reason = Column(String(255), nullable=True)
    operator_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    order_item = relationship("OrderItem", back_populates="allocations")
    targets = relationship("FulfillmentTarget", back_populates="allocation")

    __table_args__ = (
        UniqueConstraint(
            "order_item_id",
            "version_no",
            name="uq_allocation_item_version",
        ),
    )
