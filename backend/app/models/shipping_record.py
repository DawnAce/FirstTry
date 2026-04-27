from sqlalchemy import Column, Integer, ForeignKey, UniqueConstraint, Enum as SAEnum
from sqlalchemy.orm import relationship
from app.database import Base
import enum


class ShippingStatus(str, enum.Enum):
    pending = "pending"
    shipped = "shipped"


class ShippingRecord(Base):
    __tablename__ = "shipping_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    issue_id = Column(Integer, ForeignKey("issues.id", ondelete="CASCADE"), nullable=False)
    recipient_id = Column(Integer, ForeignKey("recipients.id", ondelete="CASCADE"), nullable=False)
    quantity = Column(Integer, default=0)
    status = Column(SAEnum(ShippingStatus), default=ShippingStatus.pending)

    issue = relationship("Issue", back_populates="shipping_records")
    recipient = relationship("Recipient", back_populates="shipping_records")

    __table_args__ = (UniqueConstraint("issue_id", "recipient_id"),)
