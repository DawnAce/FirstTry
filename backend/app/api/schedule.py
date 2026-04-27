from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models import PublicationSchedule
from app.schemas.schedule import ScheduleEntry

router = APIRouter(prefix="/api/schedule", tags=["schedule"])


@router.get("", response_model=List[ScheduleEntry])
def list_schedule(year: int = 2026, db: Session = Depends(get_db)):
    return (
        db.query(PublicationSchedule)
        .filter(PublicationSchedule.year == year)
        .order_by(PublicationSchedule.publish_date)
        .all()
    )
