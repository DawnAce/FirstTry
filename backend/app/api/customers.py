"""客户管理 REST API（v0，只读）。

「客户 = 收报人」：把订单履约目标按 收件人姓名 + 电话 聚合。挂在 ``/api/customers``
（auth 在 ``main.py`` include 时统一注入）。聚合逻辑在 ``customer_service``。

Endpoint map:

* ``GET /api/customers``        —— 收报人聚合列表（可搜索 + 分页）
* ``GET /api/customers/detail`` —— 单个收报人的全部在订履约明细
"""

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import User
from app.schemas.customer import CustomerDetailOut, CustomerListOut
from app.services import customer_service

router = APIRouter(prefix="/api/customers", tags=["customers"])


@router.get("", response_model=CustomerListOut)
def list_customers(
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """收报人聚合列表（客户 = 收报人）。

    可按 姓名 / 电话 / 地址 模糊搜索。只计当前在订（active 订单 + 有效明细 +
    当前分配版本的有效履约目标，排除退款 / 取消 / 暂停 / 已替换）。
    """
    return customer_service.list_customers(
        db, search=search, page=page, page_size=page_size
    )


@router.get("/detail", response_model=CustomerDetailOut)
def customer_detail(
    recipient_name: str,
    recipient_phone: Optional[str] = None,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """单个收报人（同一 姓名 + 电话）的全部在订履约明细。

    ``recipient_phone`` 省略 / 为空时匹配「无电话」组，与列表归并键一致。
    """
    return customer_service.get_customer_detail(
        db, recipient_name=recipient_name, recipient_phone=recipient_phone
    )
