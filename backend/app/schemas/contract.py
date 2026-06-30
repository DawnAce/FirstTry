"""Pydantic schemas for 合同管理（合作渠道 + 渠道合同）。

``Partner*`` / ``Contract*`` 是 admin CRUD 载荷；``*Out`` 用于响应。``ContractOut`` 含
派生字段 ``partner_name`` / ``partner_type`` / ``has_attachment`` / ``is_expiring``，由 api 组装。
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field

from app.models.contract import ContractStatus
from app.models.partner import PartnerType


# --------------------------------------------------------------------------- #
# 合作渠道 Partner
# --------------------------------------------------------------------------- #
class PartnerBase(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    partner_type: PartnerType = PartnerType.other
    contact_person: Optional[str] = Field(default=None, max_length=64)
    contact_phone: Optional[str] = Field(default=None, max_length=64)
    settlement_account: Optional[str] = Field(default=None, max_length=255)
    notes: Optional[str] = None
    active: bool = True


class PartnerCreate(PartnerBase):
    pass


class PartnerUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=128)
    partner_type: Optional[PartnerType] = None
    contact_person: Optional[str] = Field(default=None, max_length=64)
    contact_phone: Optional[str] = Field(default=None, max_length=64)
    settlement_account: Optional[str] = Field(default=None, max_length=255)
    notes: Optional[str] = None
    active: Optional[bool] = None


class PartnerOut(PartnerBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# --------------------------------------------------------------------------- #
# 渠道合同 Contract
# --------------------------------------------------------------------------- #
class ContractBase(BaseModel):
    partner_id: int
    contract_no: Optional[str] = Field(default=None, max_length=128)
    title: str = Field(min_length=1, max_length=255)
    sign_year: Optional[int] = Field(default=None, ge=1900, le=2999)
    sign_date: Optional[date] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    amount: Optional[Decimal] = Field(default=None, ge=0)
    status: ContractStatus = ContractStatus.active
    notes: Optional[str] = None


class ContractCreate(ContractBase):
    pass


class ContractUpdate(BaseModel):
    partner_id: Optional[int] = None
    contract_no: Optional[str] = Field(default=None, max_length=128)
    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    sign_year: Optional[int] = Field(default=None, ge=1900, le=2999)
    sign_date: Optional[date] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    amount: Optional[Decimal] = Field(default=None, ge=0)
    status: Optional[ContractStatus] = None
    notes: Optional[str] = None


class ContractOut(ContractBase):
    id: int
    partner_name: str = ""
    # 正常一定有值；仅当外键悬空（异常数据）时为 None —— 优雅降级，不让整页 500。
    partner_type: Optional[PartnerType] = None
    attachment_filename: Optional[str] = None
    has_attachment: bool = False
    # 派生提示：状态为生效且 end_date 在今天起 30 天内（含已过期为负不算）。
    is_expiring: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
