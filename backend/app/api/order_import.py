"""CBJ e-commerce order import — preview / commit endpoints (Phase 3b-3b)."""

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import User
from app.models.order_item import Publication
from app.services.cbj_order_import_service import (
    BatchSettings,
    commit_import,
    preview_import,
)

router = APIRouter(prefix="/api/order-import", tags=["order-import"])


@router.post("/preview")
async def preview(
    file: UploadFile = File(...),
    mode: str = Form("recent"),
    post_office_start_month: Optional[str] = Form(None),
    zto_start_month: Optional[str] = Form(None),
    cutoff_date: Optional[str] = Form(None),
    campaign: Optional[str] = Form(None),
    bonus_months: int = Form(0),
    gift_publication: Optional[str] = Form(None),
    gift_note: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="上传文件为空")
    cutoff = None
    if cutoff_date:
        try:
            cutoff = date.fromisoformat(cutoff_date)
        except ValueError:
            raise HTTPException(status_code=422, detail="截止日格式应为 YYYY-MM-DD")
    gift_pub = (gift_publication or "").strip() or None
    if gift_pub is not None:
        try:
            Publication(gift_pub)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"赠品刊物「{gift_pub}」无效")
    settings = BatchSettings(
        mode=mode,
        post_office_start_month=post_office_start_month or None,
        zto_start_month=zto_start_month or None,
        cutoff_date=cutoff,
        campaign=(campaign or "").strip() or None,
        bonus_months=max(0, bonus_months or 0),
        gift_publication=gift_pub,
        gift_note=(gift_note or "").strip() or None,
    )
    try:
        out, _ = preview_import(db, content, settings)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return out


class CommitIn(BaseModel):
    session_id: str


@router.post("/commit")
def commit(
    body: CommitIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    return commit_import(db, body.session_id, operator_id=getattr(user, "id", None))
