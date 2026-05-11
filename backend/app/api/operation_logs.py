from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from app.database import get_db
from app.models.operation_log import OperationLog
from app.schemas.operation_log import OperationLogOut

router = APIRouter(prefix="/api/operation-logs", tags=["operation-logs"])


@router.get("", response_model=List[OperationLogOut])
def list_operation_logs(
    table_name: str = Query(..., description="表名"),
    record_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    query = db.query(OperationLog).filter(OperationLog.table_name == table_name)
    if record_id is not None:
        query = query.filter(OperationLog.record_id == record_id)
    return query.order_by(OperationLog.created_at.desc()).offset(skip).limit(limit).all()
