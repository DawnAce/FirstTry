from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base


class TempPrintDetail(Base):
    __tablename__ = "temp_print_details"

    id = Column(Integer, primary_key=True, autoincrement=True)
    issue_id = Column(Integer, ForeignKey("issues.id", ondelete="CASCADE"), nullable=False)
    department = Column(String(50), nullable=False)
    custom_name = Column(String(100), nullable=True)
    quantity = Column(Integer, default=0)
    self_quantity = Column(Integer, default=0)

    issue = relationship("Issue", back_populates="temp_print_details")
