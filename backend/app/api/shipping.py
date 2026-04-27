from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models import Issue, ShippingRecord, Recipient
from app.schemas.shipping import ShippingRecordOut, ShippingDataUpdate
from app.services.shipping_service import generate_shipping_records

router = APIRouter(prefix="/api/issues/{issue_id}/shipping", tags=["shipping"])


def _to_out(record: ShippingRecord, db: Session) -> ShippingRecordOut:
    recipient = db.query(Recipient).filter(Recipient.id == record.recipient_id).first()
    return ShippingRecordOut(
        id=record.id,
        issue_id=record.issue_id,
        recipient_id=record.recipient_id,
        recipient_name=recipient.name if recipient else "",
        recipient_address=recipient.address if recipient else None,
        recipient_phone=recipient.phone if recipient else None,
        recipient_type=recipient.type.value if recipient else "",
        quantity=record.quantity,
        status=record.status,
    )


@router.get("", response_model=List[ShippingRecordOut])
def get_shipping(issue_id: int, db: Session = Depends(get_db)):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    records = db.query(ShippingRecord).filter(ShippingRecord.issue_id == issue_id).all()
    if not records:
        records = generate_shipping_records(issue_id, db)

    return [_to_out(r, db) for r in records]


@router.put("")
def update_shipping(issue_id: int, data: ShippingDataUpdate, db: Session = Depends(get_db)):
    for item in data.records:
        record = (
            db.query(ShippingRecord)
            .filter(ShippingRecord.issue_id == issue_id, ShippingRecord.recipient_id == item.recipient_id)
            .first()
        )
        if record:
            record.quantity = item.quantity
    db.commit()
    return {"message": "Shipping records updated"}


@router.post("/regenerate", response_model=List[ShippingRecordOut])
def regenerate_shipping(issue_id: int, db: Session = Depends(get_db)):
    records = generate_shipping_records(issue_id, db)
    return [_to_out(r, db) for r in records]
