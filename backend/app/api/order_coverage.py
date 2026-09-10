"""批量补订期：数据库分页候选 → 修改预览 → 原子确认。"""
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.database import get_db
from app.models import User
from app.models.order_item import DeliveryMethod, Publication
from app.schemas.order_coverage import (
    CoverageApplyIn, CoverageApplyOut, CoverageCandidatesOut, CoveragePreviewIn, CoveragePreviewOut,
)
from app.services.order_coverage_service import apply_coverage, list_candidates, preview_coverage

router = APIRouter(prefix="/api/order-coverage", tags=["orders"])


@router.get("/candidates", response_model=CoverageCandidatesOut)
def candidates(
    import_session_id: str | None = None,
    order_ids: list[int] | None = Query(default=None, max_length=500),
    source_platform: str | None = None,
    publication: Publication | None = None,
    delivery_method: DeliveryMethod | None = None,
    order_date_start: date | None = None,
    order_date_end: date | None = None,
    missing_only: bool = True,
    skip: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db), user: User = Depends(require_admin),
):
    """按明细分页，仅列生效订阅/续订；总订单数按去重后的订单计算。"""
    return list_candidates(db, user.id, import_session_id=import_session_id, order_ids=order_ids,
                           source_platform=source_platform, publication=publication, delivery_method=delivery_method,
                           order_date_start=order_date_start, order_date_end=order_date_end,
                           missing_only=missing_only, skip=skip, limit=limit)


@router.post("/preview", response_model=CoveragePreviewOut)
def preview(body: CoveragePreviewIn, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    """验证完整选中集合，返回前后日期及逐行错误，预览有效期 30 分钟。"""
    return preview_coverage(db, body, user.id)


@router.post("/apply", response_model=CoverageApplyOut)
def apply(body: CoverageApplyIn, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    """重新检查权限和冲突，仅写入预览通过的日期；任一冲突整批不写。"""
    return apply_coverage(db, body.preview_id, user.id)
