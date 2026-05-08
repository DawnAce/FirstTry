from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class ShippingDetailCreate(BaseModel):
    issue_number: int
    sheet_name: str
    name: str
    address: Optional[str] = None
    phone: Optional[str] = None
    quantity: int = 0
    publication: Optional[str] = None
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


class ShippingDetailUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    quantity: Optional[int] = None
    publication: Optional[str] = None
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


class ShippingDetailOut(BaseModel):
    id: int
    issue_number: int
    sheet_name: str
    name: str
    address: Optional[str]
    phone: Optional[str]
    quantity: int
    publication: Optional[str]
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
    created_at: Optional[datetime]
    updated_at: Optional[datetime]

    model_config = {"from_attributes": True}
