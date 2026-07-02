"""合作渠道（Partner）CRUD —— 合同管理的上游主数据。

挂在 ``/api/partners``（auth 在 main.py include 时统一注入）。读对所有登录用户开放；
增 / 改 / 删为敏感写操作，要求 ``require_admin``（与订单敏感端点一致）。
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import (
    ChannelSettlement,
    Contract,
    FulfillmentTarget,
    Partner,
    PostalDeliveryRow,
    User,
)
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
    """删除合作渠道。若仍被合同或渠道结算引用则拒绝（先处理引用 / 或把渠道停用）。"""
    partner = db.query(Partner).filter(Partner.id == partner_id).first()
    if partner is None:
        raise HTTPException(status_code=404, detail=f"合作渠道 {partner_id} 不存在")
    # partners 是上游锚点：合同(contracts) 与 渠道结算(channel_settlements) 硬引用它；
    # 作为邮局投递单位还会被 履约目标(fulfillment_targets) 与 已冻结的投递明细(postal_delivery_rows)
    # 引用。任一存在都拒删，避免生产 MySQL 触发外键 500 / SQLite 留孤儿。
    contract_count = db.query(Contract).filter(Contract.partner_id == partner_id).count()
    settlement_count = (
        db.query(ChannelSettlement)
        .filter(ChannelSettlement.partner_id == partner_id)
        .count()
    )
    target_count = (
        db.query(FulfillmentTarget)
        .filter(FulfillmentTarget.distribution_unit_id == partner_id)
        .count()
    )
    postal_row_count = (
        db.query(PostalDeliveryRow)
        .filter(PostalDeliveryRow.distribution_unit_id == partner_id)
        .count()
    )
    if contract_count or settlement_count or target_count or postal_row_count:
        parts = []
        if contract_count:
            parts.append(f"{contract_count} 份合同")
        if settlement_count:
            parts.append(f"{settlement_count} 条结算记录")
        if target_count:
            parts.append(f"{target_count} 个投递目标")
        if postal_row_count:
            parts.append(f"{postal_row_count} 条邮局投递明细")
        raise HTTPException(
            status_code=409,
            detail=f"该渠道下还有 {' / '.join(parts)}，不能删除（可改为「停用」）",
        )
    db.delete(partner)
    db.commit()
