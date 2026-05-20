from pydantic import BaseModel


class ConfirmationSummary(BaseModel):
    confirmed_report_total: int
    confirmed_shipping_total: int
    confirmed_delta: int
    confirmed_is_match: bool
    current_shipping_total: int
    current_delta: int
    current_is_match: bool
    has_shipping_drift: bool
