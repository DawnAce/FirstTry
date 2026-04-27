from sqlalchemy import Column, Integer, String, Text, DateTime, Enum as SAEnum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base
import enum


class RecipientType(str, enum.Enum):
    corporate = "corporate"
    reader = "reader"
    sample = "sample"


class RecipientFrequency(str, enum.Enum):
    weekly = "weekly"
    biweekly = "biweekly"
    monthly = "monthly"


class RecipientStatus(str, enum.Enum):
    active = "active"
    suspended = "suspended"


class Recipient(Base):
    __tablename__ = "recipients"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    phone = Column(String(20))
    province = Column(String(50))
    city = Column(String(50))
    address = Column(Text)
    type = Column(SAEnum(RecipientType), nullable=False)
    frequency = Column(SAEnum(RecipientFrequency), default=RecipientFrequency.weekly)
    status = Column(SAEnum(RecipientStatus), default=RecipientStatus.active)
    notes = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    subscriptions = relationship("Subscription", back_populates="recipient", cascade="all, delete-orphan")
    shipping_records = relationship("ShippingRecord", back_populates="recipient")
