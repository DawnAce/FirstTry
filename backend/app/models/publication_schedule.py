from sqlalchemy import Column, Integer, Date, Boolean, UniqueConstraint
from app.database import Base


class PublicationSchedule(Base):
    __tablename__ = "publication_schedule"

    id = Column(Integer, primary_key=True, autoincrement=True)
    year = Column(Integer, nullable=False)
    issue_number = Column(Integer, nullable=True)
    publish_date = Column(Date, nullable=False)
    is_suspended = Column(Boolean, default=False, nullable=False)
    page_count = Column(Integer, nullable=True)

    __table_args__ = (UniqueConstraint("year", "publish_date"),)
