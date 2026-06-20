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
    draft = "draft"
    pending_confirmation = "pending_confirmation"
    active = "active"
    void = "void"


class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_code = Column(String(64), unique=True, nullable=True, index=True)
    external_order_no = Column(String(128), nullable=True, index=True)
    order_date = Column(Date, nullable=False)
    entry_method = Column(SAEnum(OrderEntryMethod), nullable=False)
    source_platform = Column(String(64), nullable=True)
    source_store = Column(String(128), nullable=True)
    payer_name = Column(String(128), nullable=False)
    payer_contact = Column(String(64), nullable=True)
    payment_method = Column(SAEnum(OrderPaymentMethod), nullable=True)
    payment_collector = Column(String(64), nullable=True)
    total_amount = Column(Numeric(10, 2), default=0, nullable=False)
    paid_amount = Column(Numeric(10, 2), default=0, nullable=False)
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

    __table_args__ = (
        Index("ix_orders_source_status_date", "entry_method", "status", "order_date"),
        Index("ix_orders_payer", "payer_name"),
    )
