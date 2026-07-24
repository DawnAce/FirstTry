import enum

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum as SAEnum,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.sql import func

from app.database import Base


class PartnerType(str, enum.Enum):
    """合作渠道类型。"""

    logistics = "logistics"        # 物流（如中通）
    distribution = "distribution"  # 发行（如北京市报刊发行局）
    retail = "retail"              # 零售（如北京报刊零售局）
    other = "other"                # 其他渠道合作（如广州日报）


class Partner(Base):
    """合作渠道 / 合作方主数据（上游物流·发行·零售渠道）。

    合同管理（``contracts``）与将来的渠道结算都挂在 partner 下，是上游这条线的锚点。
    v0 仅维护基础档案；中通 / 北京市报刊发行局 / 北京报刊零售局 / 成都邮征天下 / 广州日报
    由迁移预置（可在页面增删改）。
    """

    __tablename__ = "partners"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(128), nullable=False)
    partner_type = Column(
        SAEnum(PartnerType),
        nullable=False,
        default=PartnerType.other,
    )
    contact_person = Column(String(64), nullable=True)
    contact_phone = Column(String(64), nullable=True)
    # 结算账户 / 开户信息（自由文本，给财务渠道结算用）。
    settlement_account = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)
    active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = (UniqueConstraint("name", name="uq_partners_name"),)
