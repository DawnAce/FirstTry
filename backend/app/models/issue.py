from sqlalchemy import Column, Integer, Date, String, Text, DateTime, Enum as SAEnum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base
import enum


class IssueStatus(str, enum.Enum):
    draft = "draft"
    confirmed = "confirmed"
    exported = "exported"


class Issue(Base):
    __tablename__ = "issues"

    id = Column(Integer, primary_key=True, autoincrement=True)
    issue_number = Column(Integer, nullable=False, unique=True)
    publish_date = Column(Date, nullable=False)
    status = Column(SAEnum(IssueStatus), default=IssueStatus.draft, nullable=False)
    page_count = Column(Integer, default=24, nullable=False, server_default="24")
    notes = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    report_entries = relationship("ReportEntry", back_populates="issue", cascade="all, delete-orphan")
    shipping_records = relationship("ShippingRecord", back_populates="issue", cascade="all, delete-orphan")
    temp_print_details = relationship("TempPrintDetail", back_populates="issue", cascade="all, delete-orphan")
    audit_snapshots = relationship("IssueAuditSnapshot", back_populates="issue", cascade="all, delete-orphan")
