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
    issue_number = Column(Integer, nullable=True, index=True)  # 期数（可空、非 FK；工作台按期过滤 feed）
    channel = Column(String(100), nullable=True)  # 渠道（单条发货操作时取 ShippingDetail.channel）
    status = Column(String(20), nullable=False, server_default="success", default="success")  # 成功/失败
    created_at = Column(DateTime, server_default=func.now(), index=True)
