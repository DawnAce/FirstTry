from pydantic import BaseModel
from typing import List, Optional
from app.models.shipping_record import ShippingStatus


class ShippingRecordOut(BaseModel):
    id: int
    issue_id: int
    recipient_id: int
    recipient_name: str
    recipient_address: Optional[str]
    recipient_phone: Optional[str]
    recipient_type: str
    quantity: int
    status: ShippingStatus

    model_config = {"from_attributes": True}


class ShippingRecordUpdate(BaseModel):
    recipient_id: int
    quantity: int


class ShippingDataUpdate(BaseModel):
    records: List[ShippingRecordUpdate]
