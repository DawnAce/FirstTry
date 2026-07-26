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
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class OrderEntryMethod(str, enum.Enum):
    """How an order entered the system (provenance / 录入方式).

    Distinct from the sales channel (which lives in ``source_platform`` /
    ``source_store``). Renamed from the legacy ``OrderSourceType`` in PR-B;
    the old 5 values mixed 4 unrelated dimensions and were normalized to
    ``manual`` by migration d8a1f4e7b9c2.
    """

    manual = "manual"
    excel_import = "excel_import"
    api_sync = "api_sync"


class OrderPaymentMethod(str, enum.Enum):
    wechat = "wechat"
    alipay = "alipay"
    bank_card = "bank_card"
    corporate_transfer = "corporate_transfer"
    cash = "cash"
    offset = "offset"
    other = "other"


class OrderStatus(str, enum.Enum):
    """Our internal record lifecycle (distinct from the commercial status)."""

    draft = "draft"
    pending_confirmation = "pending_confirmation"
    active = "active"
    void = "void"


class OrderCommercialStatus(str, enum.Enum):
    """The order's commercial state on the source e-commerce platform.

    Our own clean, curated vocabulary — the messy/incomplete platform strings are
    mapped onto this and the raw string is kept in ``source_status_raw`` for
    reference. NULL for manually-entered orders (no platform status). 已发货 also
    covers 已完成 (a subscription isn't a one-time shipment).
    """

    pending_payment = "pending_payment"   # 待付款
    paid = "paid"                          # 已付款（待发货）
    shipped = "shipped"                    # 已发货 / 已完成
    refunded = "refunded"                  # 已退款
    partial_refund = "partial_refund"      # 部分退款
    cancelled = "cancelled"                # 已取消 / 已关闭


class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_code = Column(String(64), nullable=True, index=True)
    external_order_no = Column(String(128), nullable=True, index=True)
    order_date = Column(Date, nullable=False)
    entry_method = Column(SAEnum(OrderEntryMethod), nullable=False)
    source_platform = Column(String(64), nullable=True)
    source_store = Column(String(128), nullable=True)
    # 营销活动标签（如 "2026-618"）。电商导入按批次写入，用于追溯 + 按活动统计；
    # 手工录入订单为 NULL。同批次的"赠品 / 延长月"履约差异落在订单明细上。
    campaign = Column(String(64), nullable=True, index=True)
    payer_name = Column(String(128), nullable=False)
    payer_contact = Column(String(64), nullable=True)
    payment_method = Column(SAEnum(OrderPaymentMethod), nullable=True)
    payment_collector = Column(String(64), nullable=True)
    total_amount = Column(Numeric(10, 2), default=0, nullable=False)
    paid_amount = Column(Numeric(10, 2), default=0, nullable=False)
    # 原价 / pre-discount list price (from the CBJ 原价 column). NULL for manual or
    # legacy orders that never captured it. Discount depth = original_amount − paid.
    original_amount = Column(Numeric(10, 2), nullable=True)
    # 已退款累计金额（冗余 SUM(refunds.amount)，便于筛选/净额统计）。
    # 商业状态：0 → 不变；0<refunded<paid → partial_refund；>=paid → refunded。
    refunded_amount = Column(
        Numeric(10, 2), default=0, server_default="0", nullable=False
    )
    invoice_required = Column(Boolean, default=False, nullable=False)
    invoice_title = Column(Text, nullable=True)
    invoice_tax_no = Column(String(64), nullable=True)
    invoice_recipient_email = Column(String(128), nullable=True)
    status = Column(
        SAEnum(OrderStatus),
        default=OrderStatus.draft,
        nullable=False,
        index=True,
    )
    notes = Column(Text, nullable=True)
    # Commercial status (e-commerce orders): our curated value + the raw platform
    # string for reference. NULL for manual orders.
    commercial_status = Column(SAEnum(OrderCommercialStatus), nullable=True)
    source_status_raw = Column(String(64), nullable=True)
    # Historical-archive import marker (mode == "historical"): the order is补录 for
    # records and is NOT auto-synced to shipping. It is NOT hard-excluded, though —
    # nothing in the sync path filters on this flag, so once coverage / issue_number
    # is filled in it can still be manually synced (中通). Marker only.
    is_historical_archive = Column(Boolean, default=False, nullable=False)
    # V2 hooks (V1.1 always NULL)
    import_batch_id = Column(Integer, nullable=True)
    import_row_no = Column(Integer, nullable=True)
    import_source_sheet = Column(String(64), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    items = relationship(
        "OrderItem",
        back_populates="order",
        cascade="all, delete-orphan",
    )
    events = relationship(
        "OrderEvent",
        back_populates="order",
        cascade="all, delete-orphan",
    )
    refunds = relationship(
        "Refund",
        back_populates="order",
        cascade="all, delete-orphan",
        order_by="Refund.id",
    )
    payments = relationship(
        "Payment",
        back_populates="order",
        cascade="all, delete-orphan",
        order_by="Payment.id",
    )

    __table_args__ = (
        UniqueConstraint("order_code", name="uq_orders_order_code"),
        Index("ix_orders_source_status_date", "entry_method", "status", "order_date"),
        Index("ix_orders_payer", "payer_name"),
    )
