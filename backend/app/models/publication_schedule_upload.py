from sqlalchemy import Column, DateTime, Enum as SAEnum, Integer, JSON, String, Text
from sqlalchemy.sql import func
from app.database import Base
import enum


class PublicationScheduleUploadStatus(str, enum.Enum):
    previewed = "previewed"
    committed = "committed"
    failed = "failed"


class PublicationScheduleUpload(Base):
    __tablename__ = "publication_schedule_uploads"

    id = Column(Integer, primary_key=True, autoincrement=True)
    year = Column(Integer, nullable=False, index=True)
    original_filename = Column(String(255), nullable=False)
    stored_path = Column(String(500), nullable=False)
    status = Column(
        SAEnum(PublicationScheduleUploadStatus),
        default=PublicationScheduleUploadStatus.previewed,
        nullable=False,
        index=True,
    )
    summary_json = Column(JSON, nullable=True)
    rows_json = Column(JSON, nullable=True)
    error_json = Column(JSON, nullable=True)
    uploaded_by = Column(String(50), nullable=True)
    raw_text = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    committed_at = Column(DateTime, nullable=True)
