"""合作渠道（Partner）CRUD —— 合同管理的上游主数据。

挂在 ``/api/partners``（auth 在 main.py include 时统一注入）。读对所有登录用户开放；
增 / 改 / 删为敏感写操作，要求 ``require_admin``（与订单敏感端点一致）。
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import Contract, Partner, User
from app.schemas.contract import PartnerCreate, PartnerOut, PartnerUpdate

router = APIRouter(prefix="/api/partners", tags=["partners"])


@router.get("", response_model=List[PartnerOut])
def list_partners(
    active: Optional[bool] = None,
    q: Optional[str] = Query(default=None, description="模糊匹配 名称 / 联系人"),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    query = db.query(Partner)
    if active is not None:
        query = query.filter(Partner.active.is_(active))
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            Partner.name.ilike(like) | Partner.contact_person.ilike(like)
        )
    return query.order_by(Partner.active.desc(), Partner.name).all()


@router.post("", response_model=PartnerOut, status_code=201)
def create_partner(
    data: PartnerCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    if db.query(Partner).filter(Partner.name == data.name).first() is not None:
        raise HTTPException(status_code=409, detail=f"合作渠道「{data.name}」已存在")
    partner = Partner(**data.model_dump())
    db.add(partner)
    db.commit()
    db.refresh(partner)
    return partner


@router.put("/{partner_id}", response_model=PartnerOut)
def update_partner(
    partner_id: int,
    data: PartnerUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    partner = db.query(Partner).filter(Partner.id == partner_id).first()
    if partner is None:
        raise HTTPException(status_code=404, detail=f"合作渠道 {partner_id} 不存在")

    patch = data.model_dump(exclude_unset=True)
    new_name = patch.get("name")
    if new_name is not None and new_name != partner.name:
        if db.query(Partner).filter(Partner.name == new_name).first() is not None:
            raise HTTPException(status_code=409, detail=f"合作渠道「{new_name}」已存在")
    for field, value in patch.items():
        setattr(partner, field, value)
    db.commit()
    db.refresh(partner)
    return partner


@router.delete("/{partner_id}", status_code=204)
def delete_partner(
    partner_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """删除合作渠道。若仍有合同引用则拒绝（先处理合同 / 或把渠道停用）。"""
    partner = db.query(Partner).filter(Partner.id == partner_id).first()
    if partner is None:
        raise HTTPException(status_code=404, detail=f"合作渠道 {partner_id} 不存在")
    contract_count = (
        db.query(Contract).filter(Contract.partner_id == partner_id).count()
    )
    if contract_count > 0:
        raise HTTPException(
            status_code=409,
            detail=f"该渠道下还有 {contract_count} 份合同，不能删除（可改为「停用」）",
        )
    db.delete(partner)
    db.commit()
