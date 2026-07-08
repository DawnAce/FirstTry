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


@router.get("/recent", response_model=List[OperationLogOut])
def list_recent_operation_logs(
    issue_number: Optional[int] = None,
    action: Optional[str] = None,
    table_name: Optional[str] = None,
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
):
    """跨表最近操作记录（工作台「最近操作记录」用）。

    与上面按行查询的 ``GET ''`` 不同：这里 ``table_name`` 可选，用于聚合各类操作的时间线。
    """
    query = db.query(OperationLog)
    if issue_number is not None:
        query = query.filter(OperationLog.issue_number == issue_number)
    if action:
        query = query.filter(OperationLog.action == action)
    if table_name:
        query = query.filter(OperationLog.table_name == table_name)
    return (
        query.order_by(OperationLog.created_at.desc(), OperationLog.id.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
