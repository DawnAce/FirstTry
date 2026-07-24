"""邮局收款 / 发票 REST API（财务管理）。

原挂 ``/api/postal/finance``；重构后迁至财务命名空间 ``/api/finance/postal-receipts``。
读对所有登录用户开放；写（导入提交 / 新增 / 更新 / 删除）要求 ``require_admin``。
数据模型仍复用 ``PostalFinance``，仅迁移 API 归属，不改表结构。
"""

from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import User
from app.upload import read_upload
from app.schemas.postal import (
    FinanceCreateIn,
    FinanceListOut,
    FinanceOut,
    FinanceUpdateIn,
    PostalCommitIn,
)
from app.services import postal_finance_import_service as finance_import_svc
from app.services import postal_finance_service as finance_svc

router = APIRouter(prefix="/api/finance/postal-receipts", tags=["财务-邮局收款"])


@router.get("", response_model=FinanceListOut)
def list_finance(
    platform: Optional[str] = None,
    tax_category: Optional[str] = None,
    linked: Optional[bool] = None,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    rows, total = finance_svc.list_finance(
        db, platform=platform, tax_category=tax_category, linked=linked,
        search=search, page=page, page_size=page_size,
    )
    summary = finance_svc.summarize_finance(db, platform=platform, tax_category=tax_category, search=search)
    return FinanceListOut(rows=[FinanceOut.model_validate(r) for r in rows], total=total, summary=summary)


@router.post("/import/preview")
async def finance_import_preview(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    content = await read_upload(file)
    out, _ = finance_import_svc.preview_import(db, content)
    return out


@router.post("/import/commit")
def finance_import_commit(body: PostalCommitIn, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    return finance_import_svc.commit_import(db, body.session_id, operator_id=getattr(user, "id", None))


@router.post("", response_model=FinanceOut, status_code=201)
def create_finance(
    body: FinanceCreateIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    rec = finance_svc.create_finance(db, body.model_dump(), operator_id=getattr(user, "id", None))
    return FinanceOut.model_validate(rec)


@router.put("/{finance_id}", response_model=FinanceOut)
def update_finance(
    finance_id: int,
    body: FinanceUpdateIn,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    rec = finance_svc.update_finance(db, finance_id, body.model_dump(exclude_unset=True))
    return FinanceOut.model_validate(rec)


@router.delete("/{finance_id}", status_code=204)
def delete_finance(
    finance_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    finance_svc.delete_finance(db, finance_id)
