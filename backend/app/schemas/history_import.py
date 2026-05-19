from pydantic import BaseModel


class HistoryImportRow(BaseModel):
    category_code: str
    category_name: str
    item_name: str
    destination: str = ""
    is_variable: bool
    value: int


class TempPrintDetailRow(BaseModel):
    department: str = ""
    custom_name: str = ""
    quantity: int = 0
    self_quantity: int = 0
