from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.sql import func

from app.database import Base


class ShippingFulfillmentAdjustment(Base):
    """期级实际发货核销项，例如停刊、取消寄送等无需发货份数。"""

    __tablename__ = "shipping_fulfillment_adjustments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    issue_id = Column(Integer, ForeignKey("issues.id", ondelete="CASCADE"), nullable=False, index=True)
    issue_number = Column(Integer, nullable=False, index=True)
    adjustment_type = Column(
        String(32), nullable=False, default="no_shipment_required", server_default="no_shipment_required"
    )
    quantity = Column(Integer, nullable=False)
    reason = Column(String(255), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_shipping_fulfillment_adjustments_issue_type", "issue_id", "adjustment_type"),
    )
