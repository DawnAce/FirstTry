from pydantic import BaseModel


class HistoryImportRow(BaseModel):
    category: str           # matches ReportItemTemplate.category
    display_name: str       # from ReportItemTemplate.display_name (canonical label)
    sub_category: str       # matches ReportItemTemplate.sub_category
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
    station_name: str = ""
    station_hall: str = ""
    contact_person: str = ""
    seq_number: int | None = None
    period_count: int | None = None
    confirmation: str = ""
    company: str = ""


class CommitReadiness(BaseModel):
    same_issue: bool
    issue_exists: bool
    can_commit: bool
    errors: list[str] = []


class UnmappedReportItem(BaseModel):
    item_id: str
    sheet_name: str
    source_label: str
    cell_reference: str = ""
    value: int


class ReportMappingOption(BaseModel):
    category: str
    sub_category: str
    display_name: str


class ManualReportMapping(BaseModel):
    item_id: str
    category: str
    sub_category: str


class HistoryImportPreviewOut(BaseModel):
    issue_number: int
    publish_date: str           # normalized ISO date YYYY-MM-DD
    page_count: int = 24
    report_entry_count: int
    temp_detail_count: int
    shipping_detail_count: int
    can_commit: bool            # top-level convenience copy
    import_session_id: str
    errors: list[str] = []
    warnings: list[str] = []
    readiness: CommitReadiness
    manual_temp_print_required_quantity: int = 0
    manual_temp_print_self_quantity: int = 0
    manual_temp_rows: list[TempPrintDetailRow] = []
    report_rows: list[HistoryImportRow] = []
    source_total: int = 0
    mapped_total: int = 0
    unmapped_report_items: list[UnmappedReportItem] = []
    report_mapping_options: list[ReportMappingOption] = []


class HistoryImportCommitIn(BaseModel):
    import_session_id: str
    manual_temp_rows: list[TempPrintDetailRow] | None = None
    manual_report_mappings: list[ManualReportMapping] | None = None


class HistoryImportCommitOut(BaseModel):
    issue_id: int
    issue_number: int
    report_entry_count: int
    temp_detail_count: int
    shipping_detail_count: int
    schedule_page_count_updated: bool = False
    previous_schedule_page_count: int | None = None
    new_page_count: int | None = None
