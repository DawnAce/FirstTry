from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class ShippingDetailCreate(BaseModel):
    issue_number: int
    sheet_name: str
    channel: str
    sub_channel: Optional[str] = None
    name: str
    transport: str = "中通物流"
    frequency: str = "每周"
    status: str = "正常"
    address: Optional[str] = None
    phone: Optional[str] = None
    quantity: int = 0
    deadline: Optional[str] = None
    notes: Optional[str] = None
    extra_info: Optional[str] = None
    city: Optional[str] = None
    station_name: Optional[str] = None
    station_hall: Optional[str] = None
    contact_person: Optional[str] = None
    seq_number: Optional[int] = None
    period_count: Optional[int] = None
    confirmation: Optional[str] = None
    company: Optional[str] = None
    shipped_at: Optional[str] = None


class ShippingDetailUpdate(BaseModel):
    channel: Optional[str] = None
    sub_channel: Optional[str] = None
    transport: Optional[str] = None
    frequency: Optional[str] = None
    status: Optional[str] = None
    name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    quantity: Optional[int] = None
    deadline: Optional[str] = None
    notes: Optional[str] = None
    extra_info: Optional[str] = None
    city: Optional[str] = None
    station_name: Optional[str] = None
    station_hall: Optional[str] = None
    contact_person: Optional[str] = None
    seq_number: Optional[int] = None
    period_count: Optional[int] = None
    confirmation: Optional[str] = None
    company: Optional[str] = None
    shipped_at: Optional[str] = None
class ShippingDetailOut(BaseModel):
    id: int
    issue_number: int
    sheet_name: str
    channel: str
    sub_channel: Optional[str]
    transport: str
    frequency: str
    status: str
    name: str
    address: Optional[str]
    phone: Optional[str]
    quantity: int
    deadline: Optional[str]
    notes: Optional[str]
    extra_info: Optional[str]
    city: Optional[str]
    station_name: Optional[str]
    station_hall: Optional[str]
    contact_person: Optional[str]
    seq_number: Optional[int]
    period_count: Optional[int]
    confirmation: Optional[str]
    company: Optional[str]
    shipped_at: Optional[datetime]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]

    model_config = {"from_attributes": True}
