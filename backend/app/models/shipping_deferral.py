from sqlalchemy import Column, Date, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class ShippingDeferral(Base):
    """A planned shipment delay that must be fulfilled by a later package."""

    __tablename__ = "shipping_deferrals"

    id = Column(Integer, primary_key=True, autoincrement=True)
    issue_id = Column(Integer, ForeignKey("issues.id", ondelete="CASCADE"), nullable=False, index=True)
    issue_number = Column(Integer, nullable=False, index=True)
    shipping_detail_id = Column(
        Integer,
        ForeignKey("shipping_details.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    deferral_type = Column(
        String(32), nullable=False, default="month_end_consolidation", server_default="month_end_consolidation"
    )
    target_issue_number = Column(Integer, nullable=True, index=True)
    target_publish_date = Column(Date, nullable=True, index=True)
    consolidation_batch = Column(String(32), nullable=True, index=True)
    quantity = Column(Integer, nullable=False)
    reason = Column(String(255), nullable=False)
    status = Column(String(20), nullable=False, default="pending", server_default="pending", index=True)
    fulfilled_package_id = Column(
        Integer,
        ForeignKey("shipping_packages.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    detail_name_snapshot = Column(String(100), nullable=True)
    detail_phone_snapshot = Column(String(50), nullable=True)
    detail_address_snapshot = Column(Text, nullable=True)
    detail_channel_snapshot = Column(String(255), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    fulfilled_at = Column(DateTime, nullable=True)

    shipping_detail = relationship("ShippingDetail", back_populates="deferrals")
    fulfilled_package = relationship("ShippingPackage", foreign_keys=[fulfilled_package_id])

    __table_args__ = (
        Index("ix_shipping_deferrals_issue_status", "issue_id", "status"),
        Index("ix_shipping_deferrals_detail_status", "shipping_detail_id", "status"),
    )


class ShippingPackageAllocation(Base):
    """The portion of one physical package belonging to one issue detail."""

    __tablename__ = "shipping_package_allocations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    shipping_package_id = Column(
        Integer,
        ForeignKey("shipping_packages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    shipping_detail_id = Column(
        Integer,
        ForeignKey("shipping_details.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    deferral_id = Column(
        Integer,
        ForeignKey("shipping_deferrals.id", ondelete="SET NULL"),
        nullable=True,
        unique=True,
    )
    quantity = Column(Integer, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    package = relationship("ShippingPackage", back_populates="allocations", lazy="joined")
    shipping_detail = relationship("ShippingDetail", back_populates="package_allocations")
    deferral = relationship("ShippingDeferral")

    __table_args__ = (
        Index(
            "uq_shipping_package_allocation_detail",
            "shipping_package_id",
            "shipping_detail_id",
            unique=True,
        ),
    )
