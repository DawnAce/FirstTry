from sqlalchemy import Column, Integer, Text, DateTime, ForeignKey, JSON
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base


class ReportRevision(Base):
    __tablename__ = "report_revisions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    issue_id = Column(Integer, ForeignKey("issues.id"), nullable=False)
    revision_number = Column(Integer, nullable=False, default=1)
    operator_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    reason = Column(Text)
    changes_json = Column(JSON)
    confirmed_at = Column(DateTime)
    revoked_at = Column(DateTime, server_default=func.now())

    issue = relationship("Issue")
    operator = relationship("User")
