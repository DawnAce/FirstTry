import enum

from sqlalchemy import Column, DateTime, Enum as SAEnum, ForeignKey, Index, Integer, String, Text
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
    # V1.1: order management linkage. All five are nullable so existing
    # rows (legacy manual entries) keep working unchanged. source_type
    # and sync_status get server_default so the DDL upgrade is clean.
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=True, index=True)
    order_item_id = Column(Integer, ForeignKey("order_items.id"), nullable=True)
    fulfillment_target_id = Column(Integer, ForeignKey("fulfillment_targets.id"), nullable=True)
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

    __table_args__ = (
        Index(
            "uq_shipping_detail_order_target_issue",
            "issue_number",
            "order_id",
            "order_item_id",
            "fulfillment_target_id",
            unique=True,
        ),
    )
