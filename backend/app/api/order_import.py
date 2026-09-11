"""CBJ e-commerce order import — preview / commit endpoints (Phase 3b-3b)."""

from datetime import date
import re
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import User
from app.models.order_item import Publication
from app.upload import read_upload
from app.services.cbj_order_import_service import (
    BatchSettings,
    commit_import,
    preview_import,
)

router = APIRouter(prefix="/api/order-import", tags=["order-import"])


def _explain_missing_source_schema(db: Session, error: DBAPIError) -> None:
    """只翻译来源交易的缺表/缺列错误，不返回 SQL、参数或数据库名称。"""
    original = str(error.orig)
    source_table = r"\border_source(?:s|_versions|_links|_events|_delivery_changes)\b"
    mysql_code = error.orig.args[0] if error.orig.args else None
    missing_schema = mysql_code in (1054, 1146) or bool(
        re.search(r"no such (?:table|column):", original, re.IGNORECASE)
    )
    if missing_schema and re.search(source_table, original):
        db.rollback()
        raise HTTPException(
            status_code=503,
            detail="订单来源交易的数据库升级尚未完成，暂时无法导入。请管理员完成数据库迁移后重新预览。",
        ) from None


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
    """解析并预览订单；退款识别失败返回 unresolved，补齐后重新预览。

    import 建单、retain 仅保存运费/旧订单原件，页面合并展示为可导入。
    返回结构保持兼容；缺少来源交易表或列时返回 503，提示完成迁移。
    """
    content = await read_upload(file)
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
        out, _ = preview_import(db, content, settings, owner_id=_user.id, filename=file.filename)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except DBAPIError as exc:
        _explain_missing_source_schema(db, exc)
        raise
    return out


class CommitIn(BaseModel):
    session_id: str
    confirmed_source_updates: list[str] = []
    # 往期单选填补期号：{external_order_no: 期号}。只作用于单期且无期号的行，留空=现状。
    issue_overrides: dict[str, int] | None = None
    # 商学院单期选填补期次：{external_order_no: "YYYY-MM" / "YYYY-MM~MM"}。
    issue_label_overrides: dict[str, str] | None = None


@router.post("/commit")
def commit(
    body: CommitIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    """原子确认导入；缺少来源交易结构时返回 503，保留可重试的会话。"""
    try:
        return commit_import(
            db,
            body.session_id,
            operator_id=getattr(user, "id", None),
            issue_overrides=body.issue_overrides,
            issue_label_overrides=body.issue_label_overrides,
            confirmed_source_updates=body.confirmed_source_updates,
        )
    except DBAPIError as exc:
        _explain_missing_source_schema(db, exc)
        raise
