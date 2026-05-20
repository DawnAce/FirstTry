from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class IssueAuditSnapshot(Base):
    __tablename__ = "issue_audit_snapshots"

    id = Column(Integer, primary_key=True, autoincrement=True)
    issue_id = Column(Integer, ForeignKey("issues.id", ondelete="CASCADE"), nullable=False, index=True)
    snapshot_type = Column(String(20), nullable=False, index=True)
    report_total = Column(Integer, nullable=False, default=0)
    shipping_total = Column(Integer, nullable=False, default=0)
    delta = Column(Integer, nullable=False, default=0)
    is_match = Column(Boolean, nullable=False, default=False)
    created_by = Column(String(50), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), index=True)

    issue = relationship("Issue", back_populates="audit_snapshots")
