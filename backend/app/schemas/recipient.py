from pydantic import BaseModel
from datetime import date, datetime
from typing import Optional, List
from app.models.recipient import RecipientType, RecipientFrequency, RecipientStatus
from app.models.subscription import SubscriptionType


class RecipientCreate(BaseModel):
    name: str
    phone: Optional[str] = None
    province: Optional[str] = None
    city: Optional[str] = None
    address: Optional[str] = None
    type: RecipientType
    frequency: RecipientFrequency = RecipientFrequency.weekly
    notes: Optional[str] = None


class RecipientUpdate(RecipientCreate):
    pass


class RecipientOut(BaseModel):
    id: int
    name: str
    phone: Optional[str]
    province: Optional[str]
    city: Optional[str]
    address: Optional[str]
    type: RecipientType
    frequency: RecipientFrequency
    status: RecipientStatus
    notes: Optional[str]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]
    active_subscription_end: Optional[date] = None

    model_config = {"from_attributes": True}


class SubscriptionCreate(BaseModel):
    type: SubscriptionType
    start_date: date
    end_date: date
    duration_months: Optional[int] = None
    quantity: int = 1
    notes: Optional[str] = None


class SubscriptionOut(BaseModel):
    id: int
    recipient_id: int
    type: SubscriptionType
    start_date: date
    end_date: date
    duration_months: Optional[int]
    quantity: int
    notes: Optional[str]
    created_at: Optional[datetime]

    model_config = {"from_attributes": True}


class StatusUpdate(BaseModel):
    status: RecipientStatus
