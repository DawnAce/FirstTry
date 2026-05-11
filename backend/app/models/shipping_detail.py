from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from app.database import Base


class ShippingDetail(Base):
    __tablename__ = "shipping_details"

    id = Column(Integer, primary_key=True, autoincrement=True)
    issue_number = Column(Integer, nullable=False, index=True)
    sheet_name = Column(String(50), nullable=False)
    channel = Column(String(20), nullable=False, index=True)
    transport = Column(String(20), nullable=False, default="中通物流", index=True)
    frequency = Column(String(20), nullable=False, default="每周", index=True)
    status = Column(String(10), nullable=False, default="正常", index=True)
    name = Column(String(100), nullable=False)
    address = Column(Text)
    phone = Column(String(50))
    quantity = Column(Integer, default=0)
    deadline = Column(String(50))
    notes = Column(Text)
    extra_info = Column(Text)
    city = Column(String(50))
    station_name = Column(String(100))
    station_hall = Column(String(200))
    contact_person = Column(String(100))
    seq_number = Column(Integer)
    period_count = Column(Integer)
    confirmation = Column(String(20))
    company = Column(String(100), nullable=True, index=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
