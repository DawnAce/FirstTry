from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class ShippingFulfillmentAdjustment(Base):
    """期级非运单核销项，包括无需发货和转库留存。"""

    __tablename__ = "shipping_fulfillment_adjustments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    issue_id = Column(Integer, ForeignKey("issues.id", ondelete="CASCADE"), nullable=False, index=True)
    issue_number = Column(Integer, nullable=False, index=True)
    shipping_detail_id = Column(
        Integer,
        ForeignKey("shipping_details.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    adjustment_type = Column(
        String(32), nullable=False, default="no_shipment_required", server_default="no_shipment_required"
    )
    source = Column(String(32), nullable=False, default="manual", server_default="manual", index=True)
    quantity = Column(Integer, nullable=False)
    reason = Column(String(255), nullable=False)
    detail_name_snapshot = Column(String(100), nullable=True)
    detail_phone_snapshot = Column(String(50), nullable=True)
    detail_address_snapshot = Column(Text, nullable=True)
    detail_channel_snapshot = Column(String(255), nullable=True)
    detail_company_snapshot = Column(String(100), nullable=True)
    detail_quantity_snapshot = Column(Integer, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    shipping_detail = relationship("ShippingDetail", back_populates="fulfillment_adjustments")

    @property
    def is_attributed(self) -> bool:
        return self.shipping_detail_id is not None or self.detail_name_snapshot is not None

    __table_args__ = (
        Index("ix_shipping_fulfillment_adjustments_issue_type", "issue_id", "adjustment_type"),
    )
