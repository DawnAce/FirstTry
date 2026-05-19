from pydantic import BaseModel


class HistoryImportRow(BaseModel):
    category: str
    sub_category: str
    display_name: str
    default_value: int
    is_variable: bool
    destination: str = ""


class TempPrintDetailRow(BaseModel):
    department: str = ""
    custom_name: str = ""
    quantity: int = 0
    self_quantity: int = 0
