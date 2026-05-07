from pydantic import BaseModel
from typing import Optional


class TemplateOut(BaseModel):
    id: int
    category: str
    sub_category: str
    display_name: str
    default_value: int
    is_variable: bool
    sort_order: int
    excel_sheet: Optional[str] = None
    excel_cell: Optional[str] = None

    model_config = {"from_attributes": True}


class TemplateCreate(BaseModel):
    category: str
    sub_category: str
    display_name: str
    default_value: int = 0
    is_variable: bool = False
    sort_order: int = 0
    excel_sheet: Optional[str] = None
    excel_cell: Optional[str] = None


class TemplateUpdate(BaseModel):
    category: Optional[str] = None
    sub_category: Optional[str] = None
    display_name: Optional[str] = None
    default_value: Optional[int] = None
    is_variable: Optional[bool] = None
    sort_order: Optional[int] = None
    excel_sheet: Optional[str] = None
    excel_cell: Optional[str] = None
