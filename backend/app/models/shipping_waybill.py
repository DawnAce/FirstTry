import enum

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, JSON, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class WaybillImportStatus(str, enum.Enum):
    previewed = "previewed"
    confirmed = "confirmed"


class WaybillMatchStatus(str, enum.Enum):
    matched = "matched"
    unmatched = "unmatched"
    ambiguous = "ambiguous"
    duplicate = "duplicate"
    invalid = "invalid"
    ignored = "ignored"


class ShippingWaybillImportBatch(Base):
    __tablename__ = "shipping_waybill_import_batches"

    id = Column(Integer, primary_key=True, autoincrement=True)
    issue_id = Column(Integer, ForeignKey("issues.id", ondelete="CASCADE"), nullable=False, index=True)
    issue_number = Column(Integer, nullable=False, index=True)
    filename = Column(String(255), nullable=False)
    file_hash = Column(String(64), nullable=False)
    status = Column(String(20), nullable=False, default=WaybillImportStatus.previewed.value)
    expected_quantity = Column(Integer, nullable=False, default=0)
    parsed_quantity = Column(Integer, nullable=False, default=0)
    matched_quantity = Column(Integer, nullable=False, default=0)
    pending_quantity = Column(Integer, nullable=False, default=0)
    extra_quantity = Column(Integer, nullable=False, default=0)
    matched_rows = Column(Integer, nullable=False, default=0)
    unmatched_rows = Column(Integer, nullable=False, default=0)
    warning_count = Column(Integer, nullable=False, default=0)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    confirmed_at = Column(DateTime, nullable=True)

    rows = relationship(
        "ShippingWaybillImportRow",
        back_populates="batch",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
        order_by="ShippingWaybillImportRow.id",
    )
    documents = relationship(
        "ShippingWaybillImportDocument",
        back_populates="batch",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
        order_by="ShippingWaybillImportDocument.id",
    )

    __table_args__ = (
        Index("uq_waybill_import_issue_hash", "issue_number", "file_hash", unique=True),
    )


class ShippingWaybillImportRow(Base):
    __tablename__ = "shipping_waybill_import_rows"

    id = Column(Integer, primary_key=True, autoincrement=True)
    batch_id = Column(
        Integer,
        ForeignKey("shipping_waybill_import_batches.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_sheet = Column(String(100), nullable=False)
    source_row = Column(Integer, nullable=False)
    carrier = Column(String(50), nullable=False)
    tracking_no = Column(String(100), nullable=True)
    recipient_name = Column(String(100), nullable=False)
    phone = Column(String(50), nullable=True)
    address = Column(Text, nullable=True)
    quantity = Column(Integer, nullable=False, default=0)
    no_tracking_required = Column(Boolean, nullable=False, default=False)
    raw_values = Column(JSON, nullable=True)
    manual_reviewed = Column(Boolean, nullable=False, default=False)
    match_status = Column(String(20), nullable=False)
    match_reason = Column(String(255), nullable=True)
    shipping_detail_id = Column(
        Integer,
        ForeignKey("shipping_details.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    consolidation_deferral_ids = Column(JSON, nullable=True)
    consolidation_issue_numbers = Column(JSON, nullable=True)
    consolidation_quantity = Column(Integer, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    batch = relationship("ShippingWaybillImportBatch", back_populates="rows")
    shipping_detail = relationship("ShippingDetail")
    package = relationship("ShippingPackage", back_populates="import_row", uselist=False)
    documents = relationship("ShippingWaybillImportDocument", back_populates="linked_import_row")

    @property
    def consolidation_candidate(self) -> bool:
        return bool(self.consolidation_deferral_ids)


class ShippingPackage(Base):
    __tablename__ = "shipping_packages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    shipping_detail_id = Column(
        Integer,
        ForeignKey("shipping_details.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    import_row_id = Column(
        Integer,
        ForeignKey("shipping_waybill_import_rows.id", ondelete="SET NULL"),
        nullable=True,
        unique=True,
    )
    carrier = Column(String(50), nullable=False)
    tracking_no = Column(String(100), nullable=False)
    quantity = Column(Integer, nullable=False, default=0)
    shipped_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    shipping_detail = relationship("ShippingDetail", back_populates="packages")
    import_row = relationship("ShippingWaybillImportRow", back_populates="package")
    allocations = relationship(
        "ShippingPackageAllocation",
        back_populates="package",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
        order_by="ShippingPackageAllocation.id",
    )
    documents = relationship(
        "ShippingWaybillImportDocument",
        back_populates="shipping_package",
        lazy="selectin",
        order_by="ShippingWaybillImportDocument.id",
    )

    __table_args__ = (
        Index("uq_shipping_package_carrier_tracking", "carrier", "tracking_no", unique=True),
    )


class ShippingWaybillImportDocument(Base):
    """A supporting document detected inside an actual-waybill workbook."""

    __tablename__ = "shipping_waybill_import_documents"

    id = Column(Integer, primary_key=True, autoincrement=True)
    batch_id = Column(
        Integer,
        ForeignKey("shipping_waybill_import_batches.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    linked_import_row_id = Column(
        Integer,
        ForeignKey("shipping_waybill_import_rows.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    shipping_package_id = Column(
        Integer,
        ForeignKey("shipping_packages.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    document_type = Column(String(50), nullable=False, index=True)
    source_sheet = Column(String(100), nullable=False)
    status = Column(String(20), nullable=False, index=True)
    extracted_data = Column(JSON, nullable=True)
    validation_errors = Column(JSON, nullable=True)
    parser_version = Column(String(32), nullable=False, default="1", server_default="1")
    checked_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    batch = relationship("ShippingWaybillImportBatch", back_populates="documents")
    linked_import_row = relationship("ShippingWaybillImportRow", back_populates="documents")
    shipping_package = relationship("ShippingPackage", back_populates="documents")
