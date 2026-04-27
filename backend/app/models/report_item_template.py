from sqlalchemy import Column, Integer, String, Boolean, UniqueConstraint
from app.database import Base


class ReportItemTemplate(Base):
    __tablename__ = "report_item_templates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    category = Column(String(50), nullable=False)
    sub_category = Column(String(100), nullable=False)
    display_name = Column(String(100), nullable=False)
    default_value = Column(Integer, default=0)
    is_variable = Column(Boolean, default=False, nullable=False)
    sort_order = Column(Integer, default=0)
    excel_sheet = Column(String(50))
    excel_cell = Column(String(10))

    __table_args__ = (UniqueConstraint("category", "sub_category"),)
