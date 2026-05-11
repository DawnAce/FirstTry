from sqlalchemy import Column, Integer, String, Text, DateTime, JSON
from sqlalchemy.sql import func
from app.database import Base


class OperationLog(Base):
    __tablename__ = "operation_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    table_name = Column(String(100), nullable=False, index=True)
    record_id = Column(Integer, nullable=False, index=True)
    record_name = Column(String(200), nullable=True)
    action = Column(String(20), nullable=False, index=True)  # create / update / delete
    changes = Column(JSON, nullable=True)
    user_id = Column(Integer, nullable=True)
    username = Column(String(50), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), index=True)
