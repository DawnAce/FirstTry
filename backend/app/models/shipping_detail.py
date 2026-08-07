import enum

from sqlalchemy import Column, DateTime, Enum as SAEnum, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class ShippingDetailSourceType(str, enum.Enum):
    """Where a shipping_details row originated.

    - manual: entered directly on the ZTO-MF page (legacy / V1.1 default)
    - order_generated: written by the order sync job (V1.3+)
    - historical_import: imported from a historical archive (V2)
    """

    manual = "manual"
    order_generated = "order_generated"
    historical_import = "historical_import"
    complaint_makeup = "complaint_makeup"


class ShippingDetailSyncStatus(str, enum.Enum):
    """Sync state vs the source order target (V1.3+).

    - synced: matches the linked order target as last synced
    - manually_modified: a manual edit diverged from the order target
    - orphaned: the linked order or target was voided / removed
    """

    synced = "synced"
    manually_modified = "manually_modified"
    orphaned = "orphaned"


class ShippingDetail(Base):
    __tablename__ = "shipping_details"

    id = Column(Integer, primary_key=True, autoincrement=True)
    issue_number = Column(Integer, nullable=False, index=True)
    sheet_name = Column(String(50), nullable=False)
    channel = Column(String(255), nullable=False, index=True)
    sub_channel = Column(String(255), nullable=True, index=True)
    transport = Column(String(50), nullable=False, default="中通物流", index=True)
    frequency = Column(String(50), nullable=False, default="每周", index=True)
    status = Column(String(50), nullable=False, default="正常", index=True)
    name = Column(String(100), nullable=False)
    address = Column(Text)
    phone = Column(String(50))
    quantity = Column(Integer, default=0)
    deadline = Column(String(50))
    notes = Column(Text)
    extra_info = Column(Text)
    station_name = Column(String(100))
    station_hall = Column(String(200))
    contact_person = Column(String(100))
    seq_number = Column(Integer)
    period_count = Column(Integer)
    confirmation = Column(String(50))
    company = Column(String(100), nullable=True, index=True)
    shipped_at = Column(DateTime, nullable=True)
    # 实发份数（标已发时默认 = 计划 quantity，可改成部分发）；运单号（可空，有则填）。
    # 「已发」标记 = shipped_at 非空。应发(Σquantity) − 已发(Σshipped_quantity) = 缺口。
    shipped_quantity = Column(Integer, nullable=True)
    tracking_no = Column(String(64), nullable=True)
    # 运单核销要求。数据质量状态仍由 ``status`` 表达，二者不可混用。
    shipping_requirement = Column(
        String(32), nullable=False, default="tracking_required", server_default="tracking_required", index=True
    )
    # V1.1: order management linkage. All five are nullable so existing
    # rows (legacy manual entries) keep working unchanged. source_type
    # and sync_status get server_default so the DDL upgrade is clean.
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=True, index=True)
    order_item_id = Column(Integer, ForeignKey("order_items.id"), nullable=True)
    fulfillment_target_id = Column(Integer, ForeignKey("fulfillment_targets.id"), nullable=True)
    complaint_makeup_item_id = Column(
        Integer,
        ForeignKey("postal_complaint_makeup_items.id", ondelete="SET NULL"),
        nullable=True,
    )
    source_type = Column(
        SAEnum(ShippingDetailSourceType),
        nullable=False,
        default=ShippingDetailSourceType.manual,
        server_default="manual",
        index=True,
    )
    sync_status = Column(
        SAEnum(ShippingDetailSyncStatus),
        nullable=False,
        default=ShippingDetailSyncStatus.synced,
        server_default="synced",
    )
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    complaint_makeup_item = relationship(
        "PostalComplaintMakeupItem",
        back_populates="shipping_detail",
        foreign_keys=[complaint_makeup_item_id],
    )
    packages = relationship(
        "ShippingPackage",
        back_populates="shipping_detail",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
        order_by="ShippingPackage.id",
    )
    fulfillment_adjustments = relationship(
        "ShippingFulfillmentAdjustment",
        back_populates="shipping_detail",
        passive_deletes=True,
        lazy="selectin",
        order_by="ShippingFulfillmentAdjustment.id",
    )
    deferrals = relationship(
        "ShippingDeferral",
        back_populates="shipping_detail",
        passive_deletes=True,
        lazy="selectin",
        order_by="ShippingDeferral.id",
    )
    package_allocations = relationship(
        "ShippingPackageAllocation",
        back_populates="shipping_detail",
        passive_deletes=True,
        lazy="selectin",
        order_by="ShippingPackageAllocation.id",
    )

    @property
    def physical_shipped_quantity(self) -> int:
        if self.shipping_requirement == "no_tracking_required":
            return self.quantity or 0
        package_quantity = sum(
            (package.quantity or 0) for package in self.packages if not package.allocations
        ) + sum((allocation.quantity or 0) for allocation in self.package_allocations)
        if package_quantity:
            return package_quantity
        if self.shipped_at is not None:
            return self.shipped_quantity if self.shipped_quantity is not None else (self.quantity or 0)
        return 0

    @property
    def no_shipment_quantity(self) -> int:
        return sum(max(adjustment.quantity or 0, 0) for adjustment in self.fulfillment_adjustments)

    @property
    def deferred_quantity(self) -> int:
        return sum(
            max(deferral.quantity or 0, 0)
            for deferral in self.deferrals
            if deferral.status == "pending"
        )

    @property
    def no_shipment_reason(self) -> str | None:
        reasons = list(dict.fromkeys(
            adjustment.reason.strip()
            for adjustment in self.fulfillment_adjustments
            if adjustment.reason and adjustment.reason.strip()
        ))
        return "；".join(reasons) or None

    @property
    def handled_quantity(self) -> int:
        return min(self.physical_shipped_quantity + self.no_shipment_quantity, self.quantity or 0)

    @property
    def package_count(self) -> int:
        return len({
            *(package.id for package in self.packages),
            *(allocation.shipping_package_id for allocation in self.package_allocations),
        })

    @property
    def fulfillment_status(self) -> str:
        if self.shipping_requirement == "no_tracking_required":
            return "no_tracking_required"
        handled = self.handled_quantity
        planned = self.quantity or 0
        if handled <= 0:
            return "pending"
        if handled < planned:
            return "partial"
        if self.no_shipment_quantity and self.physical_shipped_quantity <= 0:
            return "no_shipment_required"
        return "shipped"

    @property
    def complaint_makeup_task_id(self):
        return self.complaint_makeup_item.task_id if self.complaint_makeup_item else None

    @property
    def complaint_ticket_id(self):
        return self.complaint_makeup_item.task.complaint_id if self.complaint_makeup_item else None

    @property
    def postal_delivery_id(self):
        return self.complaint_makeup_item.task.postal_delivery_id if self.complaint_makeup_item else None

    __table_args__ = (
        Index(
            "uq_shipping_detail_order_target_issue",
            "issue_number",
            "order_id",
            "order_item_id",
            "fulfillment_target_id",
            unique=True,
        ),
        Index(
            "ix_shipping_details_makeup_item",
            "complaint_makeup_item_id",
            unique=True,
        ),
    )
