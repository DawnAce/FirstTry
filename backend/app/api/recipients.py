from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
from typing import List, Optional
from datetime import date
from app.database import get_db
from app.models import Recipient, Subscription, RecipientStatus
from app.schemas.recipient import (
    RecipientCreate, RecipientUpdate, RecipientOut,
    SubscriptionCreate, SubscriptionOut, StatusUpdate,
)
from app.services.address_service import normalize_address

router = APIRouter(prefix="/api/recipients", tags=["recipients"])


def _enrich_recipient(recipient: Recipient, db: Session) -> RecipientOut:
    """Add active_subscription_end to recipient output."""
    latest_sub = (
        db.query(Subscription)
        .filter(Subscription.recipient_id == recipient.id, Subscription.end_date >= date.today())
        .order_by(desc(Subscription.end_date))
        .first()
    )
    out = RecipientOut.model_validate(recipient)
    out.active_subscription_end = latest_sub.end_date if latest_sub else None
    return out


@router.get("", response_model=List[RecipientOut])
def list_recipients(
    type: Optional[str] = None,
    frequency: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    query = db.query(Recipient)
    if type:
        query = query.filter(Recipient.type == type)
    if frequency:
        query = query.filter(Recipient.frequency == frequency)
    if status:
        query = query.filter(Recipient.status == status)
    if search:
        query = query.filter(Recipient.name.contains(search))
    recipients = query.order_by(Recipient.id).offset(skip).limit(limit).all()
    return [_enrich_recipient(r, db) for r in recipients]


@router.post("", response_model=RecipientOut, status_code=201)
def create_recipient(data: RecipientCreate, db: Session = Depends(get_db)):
    dump = data.model_dump()
    if dump.get("address"):
        parsed = normalize_address(dump["address"])
        dump["address"] = parsed["address"]
        if not dump.get("province") and parsed["province"]:
            dump["province"] = parsed["province"]
        if not dump.get("city") and parsed["city"]:
            dump["city"] = parsed["city"]
    recipient = Recipient(**dump)
    db.add(recipient)
    db.commit()
    db.refresh(recipient)
    return _enrich_recipient(recipient, db)


@router.put("/{recipient_id}", response_model=RecipientOut)
def update_recipient(recipient_id: int, data: RecipientUpdate, db: Session = Depends(get_db)):
    recipient = db.query(Recipient).filter(Recipient.id == recipient_id).first()
    if not recipient:
        raise HTTPException(status_code=404, detail="收件人不存在")
    update_data = data.model_dump()
    if update_data.get("address"):
        parsed = normalize_address(update_data["address"])
        update_data["address"] = parsed["address"]
        if not update_data.get("province") and parsed["province"]:
            update_data["province"] = parsed["province"]
        if not update_data.get("city") and parsed["city"]:
            update_data["city"] = parsed["city"]
    for key, value in update_data.items():
        setattr(recipient, key, value)
    db.commit()
    db.refresh(recipient)
    return _enrich_recipient(recipient, db)


@router.patch("/{recipient_id}/status", response_model=RecipientOut)
def update_status(recipient_id: int, data: StatusUpdate, db: Session = Depends(get_db)):
    recipient = db.query(Recipient).filter(Recipient.id == recipient_id).first()
    if not recipient:
        raise HTTPException(status_code=404, detail="收件人不存在")
    recipient.status = data.status
    db.commit()
    db.refresh(recipient)
    return _enrich_recipient(recipient, db)


# --- Subscriptions ---

@router.get("/{recipient_id}/subscriptions", response_model=List[SubscriptionOut])
def list_subscriptions(recipient_id: int, db: Session = Depends(get_db)):
    return (
        db.query(Subscription)
        .filter(Subscription.recipient_id == recipient_id)
        .order_by(desc(Subscription.created_at))
        .all()
    )


@router.post("/{recipient_id}/subscriptions", response_model=SubscriptionOut, status_code=201)
def create_subscription(recipient_id: int, data: SubscriptionCreate, db: Session = Depends(get_db)):
    recipient = db.query(Recipient).filter(Recipient.id == recipient_id).first()
    if not recipient:
        raise HTTPException(status_code=404, detail="收件人不存在")

    sub = Subscription(recipient_id=recipient_id, **data.model_dump())
    db.add(sub)

    # Auto-activate if subscription is current
    if data.start_date <= date.today() <= data.end_date:
        recipient.status = RecipientStatus.active

    db.commit()
    db.refresh(sub)
    return sub
