"""渠道合同（Contract）CRUD + 扫描件附件。

挂在 ``/api/contracts``（auth 在 main.py include 时统一注入）。读 / 下载对所有登录用户开放；
增 / 改 / 删 / 传 / 删附件为敏感写操作，要求 ``require_admin``。附件落盘走 ``attachment_service``，
下载经本接口鉴权后 ``FileResponse`` 流式返回（不静态暴露）。
"""

from contextlib import suppress
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import ChannelSettlement, Contract, ContractStatus, Partner, User
from app.schemas.contract import ContractCreate, ContractOut, ContractUpdate
from app.services import attachment_service

router = APIRouter(prefix="/api/contracts", tags=["contracts"])

ATTACHMENT_CATEGORY = "contracts"
MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
MAX_ATTACHMENT_MB = MAX_ATTACHMENT_BYTES // (1024 * 1024)
ALLOWED_SUFFIXES = {".pdf", ".jpg", ".jpeg", ".png"}
EXPIRING_WINDOW_DAYS = 30


def _is_expiring(contract: Contract) -> bool:
    """生效合同且 end_date 在今天起 ``EXPIRING_WINDOW_DAYS`` 天内（已过期为负不算）。"""
    if contract.status != ContractStatus.active or contract.end_date is None:
        return False
    days = (contract.end_date - date.today()).days
    return 0 <= days <= EXPIRING_WINDOW_DAYS


def _to_out(contract: Contract) -> ContractOut:
    return ContractOut(
        id=contract.id,
        partner_id=contract.partner_id,
        partner_name=contract.partner.name if contract.partner else "",
        partner_type=contract.partner.partner_type if contract.partner else None,
        contract_no=contract.contract_no,
        title=contract.title,
        sign_year=contract.sign_year,
        sign_date=contract.sign_date,
        start_date=contract.start_date,
        end_date=contract.end_date,
        amount=contract.amount,
        status=contract.status,
        notes=contract.notes,
        attachment_filename=contract.attachment_filename,
        has_attachment=bool(contract.attachment_path),
        is_expiring=_is_expiring(contract),
        created_at=contract.created_at,
        updated_at=contract.updated_at,
    )


def _get_or_404(db: Session, contract_id: int) -> Contract:
    contract = db.query(Contract).filter(Contract.id == contract_id).first()
    if contract is None:
        raise HTTPException(status_code=404, detail=f"合同 {contract_id} 不存在")
    return contract


def _require_partner(db: Session, partner_id: int) -> Partner:
    partner = db.query(Partner).filter(Partner.id == partner_id).first()
    if partner is None:
        raise HTTPException(status_code=400, detail=f"合作渠道 {partner_id} 不存在")
    return partner


@router.get("", response_model=List[ContractOut])
def list_contracts(
    partner_id: Optional[int] = None,
    status: Optional[ContractStatus] = None,
    sign_year: Optional[int] = None,
    q: Optional[str] = Query(default=None, description="模糊匹配 标题 / 合同号"),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    query = db.query(Contract)
    if partner_id is not None:
        query = query.filter(Contract.partner_id == partner_id)
    if status is not None:
        query = query.filter(Contract.status == status)
    if sign_year is not None:
        query = query.filter(Contract.sign_year == sign_year)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            Contract.title.ilike(like) | Contract.contract_no.ilike(like)
        )
    # 不用 nullslast()（MySQL 不支持该语法）；两库 DESC 下 NULL 本就排末尾，符合预期。
    contracts = query.order_by(
        Contract.sign_year.desc(),
        Contract.id.desc(),
    ).all()
    return [_to_out(c) for c in contracts]


@router.get("/{contract_id}", response_model=ContractOut)
def get_contract(
    contract_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    return _to_out(_get_or_404(db, contract_id))


@router.post("", response_model=ContractOut, status_code=201)
def create_contract(
    data: ContractCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    _require_partner(db, data.partner_id)
    contract = Contract(**data.model_dump(), created_by=admin.id)
    db.add(contract)
    db.commit()
    db.refresh(contract)
    return _to_out(contract)


@router.put("/{contract_id}", response_model=ContractOut)
def update_contract(
    contract_id: int,
    data: ContractUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    contract = _get_or_404(db, contract_id)
    patch = data.model_dump(exclude_unset=True)
    if "partner_id" in patch and patch["partner_id"] != contract.partner_id:
        _require_partner(db, patch["partner_id"])
    for field, value in patch.items():
        setattr(contract, field, value)
    db.commit()
    db.refresh(contract)
    return _to_out(contract)


@router.delete("/{contract_id}", status_code=204)
def delete_contract(
    contract_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    contract = _get_or_404(db, contract_id)
    # 渠道结算可经 contract_id 引用本合同（可空外键，无 ON DELETE）——有引用则拒删，
    # 避免生产 MySQL 外键 500 / SQLite 留悬空引用。
    settlement_count = (
        db.query(ChannelSettlement)
        .filter(ChannelSettlement.contract_id == contract_id)
        .count()
    )
    if settlement_count:
        raise HTTPException(
            status_code=409,
            detail=f"该合同被 {settlement_count} 条结算记录引用，请先解除关联（或将合同状态改为「作废」）",
        )
    stored_path = contract.attachment_path
    db.delete(contract)
    db.commit()
    # 行删除成功后再清理落盘文件（删文件失败不影响数据一致性）。
    attachment_service.delete_file(stored_path)


# --------------------------------------------------------------------------- #
# 扫描件附件
# --------------------------------------------------------------------------- #
@router.post("/{contract_id}/attachment", response_model=ContractOut)
async def upload_attachment(
    contract_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """上传 / 替换合同扫描件（PDF / 图片）。替换时删除旧文件。"""
    contract = _get_or_404(db, contract_id)

    filename = (file.filename or "").strip() or "contract"
    suffix = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(
            status_code=400, detail="仅支持 PDF / JPG / PNG 扫描件"
        )

    content = await file.read(MAX_ATTACHMENT_BYTES + 1)
    if len(content) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(
            status_code=400, detail=f"附件不能超过 {MAX_ATTACHMENT_MB} MB"
        )
    if not content:
        raise HTTPException(status_code=400, detail="上传文件为空")

    old_path = contract.attachment_path
    stored_path = attachment_service.store_file(ATTACHMENT_CATEGORY, filename, content)
    contract.attachment_path = stored_path
    contract.attachment_filename = filename
    try:
        db.commit()
    except Exception:
        # 提交失败：刚写盘的新文件尚未被任何行引用，清理掉避免孤儿；旧文件保持不动。
        with suppress(Exception):
            db.rollback()
        attachment_service.delete_file(stored_path)
        raise
    db.refresh(contract)
    if old_path and old_path != stored_path:
        attachment_service.delete_file(old_path)
    return _to_out(contract)


@router.get("/{contract_id}/attachment")
def download_attachment(
    contract_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """鉴权下载合同扫描件（任何登录用户可下载；不静态暴露）。"""
    contract = _get_or_404(db, contract_id)
    if not contract.attachment_path:
        raise HTTPException(status_code=404, detail="该合同没有附件")
    try:
        path = attachment_service.resolve_path(contract.attachment_path)
    except ValueError:
        raise HTTPException(status_code=404, detail="附件路径无效")
    if not path.exists():
        raise HTTPException(status_code=404, detail="附件文件丢失")
    return FileResponse(
        path,
        filename=contract.attachment_filename or path.name,
    )


@router.delete("/{contract_id}/attachment", response_model=ContractOut)
def delete_attachment(
    contract_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    contract = _get_or_404(db, contract_id)
    old_path = contract.attachment_path
    contract.attachment_path = None
    contract.attachment_filename = None
    db.commit()
    db.refresh(contract)
    attachment_service.delete_file(old_path)
    return _to_out(contract)
