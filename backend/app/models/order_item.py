import enum

from sqlalchemy import (
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


class Publication(str, enum.Enum):
    cbj = "cbj"
    business_school = "business_school"
    other = "other"


class PublicationFormat(str, enum.Enum):
    paper = "paper"
    digital = "digital"


class FulfillmentType(str, enum.Enum):
    subscription = "subscription"
    single_issue = "single_issue"
    gift = "gift"
    makeup = "makeup"
    extension = "extension"        # V2 hook
    replacement = "replacement"    # V2 hook


class BillingType(str, enum.Enum):
    paid = "paid"
    free_gift = "free_gift"
    bundle_gift = "bundle_gift"


class OrderItemStatus(str, enum.Enum):
    active = "active"
    cancelled = "cancelled"


class OrderItem(Base):
    __tablename__ = "order_items"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(
        Integer,
        ForeignKey("orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    publication = Column(
        SAEnum(Publication),
        nullable=False,
        default=Publication.cbj,
    )
    publication_format = Column(
        SAEnum(PublicationFormat),
        nullable=False,
        default=PublicationFormat.paper,
    )
    fulfillment_type = Column(SAEnum(FulfillmentType), nullable=False)
    billing_type = Column(
        SAEnum(BillingType),
        nullable=False,
        default=BillingType.paid,
    )
    coverage_start_date = Column(Date, nullable=True)
    coverage_end_date = Column(Date, nullable=True)
    issue_number = Column(Integer, nullable=True)
    total_quantity = Column(Integer, default=1, nullable=False)
    unit_price = Column(Numeric(10, 2), default=0, nullable=False)
    subtotal = Column(Numeric(10, 2), default=0, nullable=False)
    expected_issues_at_creation = Column(Integer, nullable=True)
    status = Column(
        SAEnum(OrderItemStatus),
        default=OrderItemStatus.active,
        nullable=False,
    )
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    order = relationship("Order", back_populates="items")
    allocations = relationship(
        "FulfillmentAllocation",
        back_populates="order_item",
        cascade="all, delete-orphan",
    )
    targets = relationship(
        "FulfillmentTarget",
        back_populates="order_item",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index(
            "ix_order_items_publication_type_status",
            "publication",
            "fulfillment_type",
            "status",
        ),
        Index(
            "ix_order_items_coverage",
            "coverage_start_date",
            "coverage_end_date",
        ),
    )
