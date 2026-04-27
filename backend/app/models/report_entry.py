from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from app.database import Base


class ReportEntry(Base):
    __tablename__ = "report_entries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    issue_id = Column(Integer, ForeignKey("issues.id", ondelete="CASCADE"), nullable=False)
    category = Column(String(50), nullable=False)
    sub_category = Column(String(100), nullable=False)
    value = Column(Integer, default=0)
    is_variable = Column(Boolean, default=False)

    issue = relationship("Issue", back_populates="report_entries")

    __table_args__ = (UniqueConstraint("issue_id", "category", "sub_category"),)
