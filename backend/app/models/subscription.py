from sqlalchemy import Column, Integer, Date, Text, DateTime, ForeignKey, Enum as SAEnum, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base
import enum


class SubscriptionType(str, enum.Enum):
    new = "new"
    renewal = "renewal"


class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    recipient_id = Column(Integer, ForeignKey("recipients.id", ondelete="CASCADE"), nullable=False)
    type = Column(SAEnum(SubscriptionType), nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    duration_months = Column(Integer)
    quantity = Column(Integer, default=1)
    notes = Column(Text)
    created_at = Column(DateTime, server_default=func.now())

    recipient = relationship("Recipient", back_populates="subscriptions")

    __table_args__ = (Index("idx_recipient_created", "recipient_id", "created_at"),)
