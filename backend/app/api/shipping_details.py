from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from app.database import get_db
from app.models.shipping_detail import ShippingDetail
from app.schemas.shipping_detail import (
    ShippingDetailCreate, ShippingDetailUpdate, ShippingDetailOut,
)

router = APIRouter(prefix="/api/shipping-details", tags=["shipping-details"])


@router.get("", response_model=List[ShippingDetailOut])
def list_shipping_details(
    issue_number: Optional[int] = None,
    sheet_name: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
):
    query = db.query(ShippingDetail)
    if issue_number is not None:
        query = query.filter(ShippingDetail.issue_number == issue_number)
    if sheet_name:
        query = query.filter(ShippingDetail.sheet_name == sheet_name)
    if search:
        query = query.filter(ShippingDetail.name.contains(search))
    return query.order_by(ShippingDetail.id).offset(skip).limit(limit).all()


@router.get("/sheets", response_model=List[str])
def list_sheets(
    issue_number: Optional[int] = None,
    db: Session = Depends(get_db),
):
    query = db.query(ShippingDetail.sheet_name).distinct()
    if issue_number is not None:
        query = query.filter(ShippingDetail.issue_number == issue_number)
    return [row[0] for row in query.all()]


@router.post("", response_model=ShippingDetailOut, status_code=201)
def create_shipping_detail(data: ShippingDetailCreate, db: Session = Depends(get_db)):
    detail = ShippingDetail(**data.model_dump())
    db.add(detail)
    db.commit()
    db.refresh(detail)
    return detail


@router.put("/{detail_id}", response_model=ShippingDetailOut)
def update_shipping_detail(detail_id: int, data: ShippingDetailUpdate, db: Session = Depends(get_db)):
    detail = db.query(ShippingDetail).filter(ShippingDetail.id == detail_id).first()
    if not detail:
        raise HTTPException(status_code=404, detail="Shipping detail not found")
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(detail, key, value)
    db.commit()
    db.refresh(detail)
    return detail


@router.delete("/{detail_id}")
def delete_shipping_detail(detail_id: int, db: Session = Depends(get_db)):
    detail = db.query(ShippingDetail).filter(ShippingDetail.id == detail_id).first()
    if not detail:
        raise HTTPException(status_code=404, detail="Shipping detail not found")
    db.delete(detail)
    db.commit()
    return {"message": "Deleted"}
