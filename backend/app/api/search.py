"""全局搜索 REST API（顶栏快速跳转）。

挂 ``/api/search``（auth 在 main.py include 时统一注入）。读对所有登录用户开放。
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import User
from app.schemas.search import GlobalSearchOut
from app.services import search_service

router = APIRouter(prefix="/api", tags=["search"])


@router.get("/search", response_model=GlobalSearchOut)
def global_search(
    q: str = "",
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """跨 订单/收报人/商品/期数 检索，各类返回 top-N 供顶栏下拉快速跳转。"""
    return GlobalSearchOut(items=search_service.global_search(db, q))
