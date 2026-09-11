"""CBJ e-commerce order import — preview / commit endpoints (Phase 3b-3b)."""

from datetime import date
import re
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
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
from app.schemas.order_import_review import (
    ImportReviewIn, ImportFeeLinksIn, ImportDraftOut, ImportFeeCandidatesOut, ImportCommitOut,
)
from app.services import order_import_review_service as reviews, order_import_fee_service as fees
from app.order_import_cache import serialized_import

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


@router.post("/preview", response_model=ImportDraftOut)
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
    不确定的最新一期在 items[].issue_review 返回核对依据；issue_review_options
    提供刊期表中的可选期号及出版日期，确认时必须逐明细提交人工核对结果。
    reviews 提供投递、状态、金额或人工订期待核对事项；version 用于后续草稿编辑。
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
    expected_version: int | None = Field(default=None, strict=True, ge=1)
    confirmed_source_updates: list[str] = []
    # 明确确认的期号：{来源单号#明细序号: 期号}，允许修正自动建议，必须是刊期表有效期号。
    confirmed_issue_numbers: dict[str, Annotated[int, Field(strict=True, gt=0)]] = Field(default_factory=dict)
    # 往期单选填补期号：{external_order_no: 期号}。只作用于单期且无期号的行，留空=现状。
    issue_overrides: dict[str, int] | None = None
    # 商学院单期选填补期次：{external_order_no: "YYYY-MM" / "YYYY-MM~MM"}。
    issue_label_overrides: dict[str, str] | None = None


@router.post("/commit", response_model=ImportCommitOut)
def commit(
    body: CommitIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    """原子保存订单、来源、核对审计及选定运费关联。

    必核项未完成、草稿/商品/刊期/关联目标变化返回 409，无效输入返回 422；
    缺少来源交易结构时返回 503。失败保留会话，成功返回逐笔运费后续处理入口数据。
    """
    try:
        return commit_import(
            db,
            body.session_id,
            operator_id=getattr(user, "id", None),
            issue_overrides=body.issue_overrides,
            issue_label_overrides=body.issue_label_overrides,
            confirmed_source_updates=body.confirmed_source_updates,
            confirmed_issue_numbers=body.confirmed_issue_numbers,
            expected_version=body.expected_version,
        )
    except DBAPIError as exc:
        _explain_missing_source_schema(db, exc)
        raise


@router.get("/sessions/{session_id}", response_model=ImportDraftOut)
@serialized_import
def current_draft(session_id: str, user: User = Depends(get_current_user)):
    """刷新当前用户的导入草稿；不读取或改写正式订单。"""
    return reviews.output(reviews.draft(session_id, user.id), session_id)


@router.post("/sessions/{session_id}/review", response_model=ImportDraftOut)
def review_draft(session_id: str, body: ImportReviewIn, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    """确认/修正投递、状态、分摊、日期或商品；版本过期409，无效值422。只更新草稿。"""
    return reviews.review(db, session_id, body, user.id)


@router.get("/sessions/{session_id}/fee-candidates", response_model=ImportFeeCandidatesOut)
def fee_candidates(session_id: str, external_order_no: str, search: str | None = None,
                   db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """推荐已有及本批订阅收件目标，不自动关联、不提前保存运费。"""
    return fees.candidates(db, session_id, external_order_no, user.id, search)


@router.post("/sessions/{session_id}/fee-links", response_model=ImportDraftOut)
def fee_links(session_id: str, body: ImportFeeLinksIn, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    """保存运费归属草稿；最终导入时重新验证并原子建立关联，不自动转投。"""
    return fees.save_links(db, session_id, body, user.id)
