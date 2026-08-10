import enum

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Index,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class SettlementStatus(str, enum.Enum):
    pending = "pending"      # 待结算
    paid = "paid"            # 已结款（应收=收款，应付=付款）
    invoiced = "invoiced"    # 已开票（方向决定销项/进项语义）
    archived = "archived"    # 已归档


class SettlementDirection(str, enum.Enum):
    receivable = "receivable"  # 应收：我方开销项发票、向渠道收款
    payable = "payable"        # 应付：对方开进项发票、我方向渠道付款


class SettlementPartyType(str, enum.Enum):
    channel = "channel"        # 渠道结算
    individual = "individual"  # 个人结算（仍复用合作方主数据）


class SettlementType(str, enum.Enum):
    consignment = "consignment"  # 代销
    buyout = "buyout"             # 包销


class SettlementInvoiceStatus(str, enum.Enum):
    unissued = "unissued"
    issued = "issued"


class SettlementPaymentStatus(str, enum.Enum):
    unpaid = "unpaid"
    partial = "partial"
    paid = "paid"


class SettlementAttachmentCategory(str, enum.Enum):
    settlement_sheet = "settlement_sheet"
    invoice_application = "invoice_application"
    invoice = "invoice"
    other = "other"


class ChannelSettlement(Base):
    """渠道结算记录（与合作渠道按周期对账、结款和开票归档）。

    挂在 ``partner`` 下（可选关联 ``contract``）。按方向表达应收/应付、销项/进项，
    结算单、开票申请和发票经 ``attachment_service`` 落盘归档。
    复用模块二的 ``partners`` 主表，是上游「渠道侧」财务这条线。
    """

    __tablename__ = "channel_settlements"

    id = Column(Integer, primary_key=True, autoincrement=True)
    partner_id = Column(
        Integer,
        ForeignKey("partners.id"),
        nullable=False,
        index=False,
    )
    contract_id = Column(
        Integer,
        ForeignKey("contracts.id"),
        nullable=True,
        index=False,
    )
    # ``period`` 仅为历史自由文本兼容；新记录使用结构化起止日期。
    period = Column(String(32), nullable=True)
    direction = Column(
        SAEnum(SettlementDirection),
        default=SettlementDirection.payable,
        nullable=False,
    )
    party_type = Column(
        SAEnum(SettlementPartyType),
        default=SettlementPartyType.channel,
        nullable=False,
    )
    settlement_type = Column(SAEnum(SettlementType), nullable=True)
    system_no = Column(String(64), nullable=False)
    external_no = Column(String(128), nullable=True)
    # 旧字段仅作一个版本周期的 API / 数据兼容，语义等同历史外部单号。
    settlement_no = Column(String(64), nullable=True)
    settlement_start_date = Column(Date, nullable=True)
    settlement_end_date = Column(Date, nullable=True)
    return_start_date = Column(Date, nullable=True)
    return_end_date = Column(Date, nullable=True)
    gross_amount = Column(Numeric(12, 2), nullable=True)      # 正常报款/结算总额
    return_deduction_amount = Column(
        Numeric(12, 2), default=0, server_default="0", nullable=False
    )
    amount_due = Column(Numeric(12, 2), nullable=True)        # 应结
    paid_amount = Column(Numeric(12, 2), nullable=True)       # 已打款
    paid_date = Column(Date, nullable=True)                   # 打款日
    on_time = Column(Boolean, nullable=True)                  # 是否按时
    invoice_received = Column(Boolean, default=False, nullable=False)  # 是否已开票
    invoice_status = Column(
        SAEnum(SettlementInvoiceStatus),
        default=SettlementInvoiceStatus.unissued,
        nullable=False,
    )
    payment_status = Column(
        SAEnum(SettlementPaymentStatus),
        default=SettlementPaymentStatus.unpaid,
        nullable=False,
    )
    invoice_no = Column(String(64), nullable=True)            # 销项/进项发票号
    invoice_date = Column(Date, nullable=True)
    invoice_title = Column(String(255), nullable=True)
    invoice_tax_no = Column(String(64), nullable=True)
    invoice_taxpayer_type = Column(String(32), nullable=True)
    invoice_type = Column(String(32), nullable=True)
    invoice_item_name = Column(String(255), nullable=True)
    invoice_unit = Column(String(32), nullable=True)
    invoice_quantity = Column(Numeric(12, 2), nullable=True)
    invoice_unit_price = Column(Numeric(12, 4), nullable=True)
    invoice_tax_rate = Column(Numeric(5, 4), nullable=True)
    invoice_amount = Column(Numeric(12, 2), nullable=True)
    status = Column(
        SAEnum(SettlementStatus),
        default=SettlementStatus.pending,
        nullable=False,
        index=False,
    )
    attachment_filename = Column(String(255), nullable=True)
    attachment_path = Column(String(500), nullable=True)
    notes = Column(Text, nullable=True)
    recognition_source_filename = Column(String(255), nullable=True)
    recognition_parser_version = Column(String(32), nullable=True)
    recognition_result = Column(JSON, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    partner = relationship("Partner")
    contract = relationship("Contract")
    attachments = relationship(
        "SettlementAttachment",
        cascade="all, delete-orphan",
        order_by="SettlementAttachment.id",
        back_populates="settlement",
    )

    __table_args__ = (
        Index("ix_settlements_partner_id", "partner_id"),
        Index("ix_settlements_contract_id", "contract_id"),
        Index("ix_settlements_period", "period"),
        Index("ux_settlements_system_no", "system_no", unique=True),
        Index("ix_settlements_external_no", "external_no"),
        Index(
            "ix_settlements_structured_period",
            "settlement_start_date",
            "settlement_end_date",
        ),
        Index("ix_settlements_status", "status"),
    )


class SettlementAttachment(Base):
    """一条渠道结算可归档多份、带类型的凭证。"""

    __tablename__ = "settlement_attachments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    settlement_id = Column(
        Integer,
        ForeignKey("channel_settlements.id", ondelete="CASCADE"),
        nullable=False,
    )
    category = Column(
        SAEnum(SettlementAttachmentCategory),
        default=SettlementAttachmentCategory.other,
        nullable=False,
    )
    filename = Column(String(255), nullable=False)
    path = Column(String(500), nullable=False)
    content_type = Column(String(128), nullable=True)
    file_size = Column(Integer, nullable=True)
    sha256 = Column(String(64), nullable=True)
    # 只有一份结算单可作为主表驱动表单回填；其他结算单仅归档。
    is_primary = Column(Boolean, default=False, server_default="0", nullable=False)
    recognized = Column(Boolean, nullable=True)
    recognition_parser_version = Column(String(32), nullable=True)
    recognition_result = Column(JSON, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    settlement = relationship("ChannelSettlement", back_populates="attachments")

    __table_args__ = (
        Index("ix_settlement_attachments_settlement_id", "settlement_id"),
        Index("ix_settlement_attachments_sha256", "sha256"),
    )
