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


class ShippingImportRow(BaseModel):
    sheet_name: str = ""
    channel: str = ""
    sub_channel: str = ""
    transport: str = ""
    frequency: str = ""
    status: str = ""
    name: str = ""
    address: str = ""
    phone: str = ""
    quantity: int = 0
    deadline: str = ""
    notes: str = ""
    extra_info: str = ""
    city: str = ""
    station_name: str = ""
    station_hall: str = ""
    contact_person: str = ""
    seq_number: int | None = None
    period_count: int | None = None
    company: str = ""


class CommitReadiness(BaseModel):
    can_commit: bool
    errors: list[str] = []


class HistoryImportPreviewOut(BaseModel):
    issue_number: int
    publish_date: str
    report_entry_count: int
    temp_detail_count: int
    shipping_detail_count: int
    can_commit: bool
    import_session_id: str
    errors: list[str] = []
