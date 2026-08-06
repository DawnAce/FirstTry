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
    plan_delta: int
    plan_is_match: bool
    plan_attributed_quantity: int
    plan_unexplained_delta: int
    plan_is_reconciled: bool
    unattributed_adjustment_quantity: int
