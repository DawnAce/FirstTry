"""Original report source files and their per-issue business mappings.

The source document is immutable evidence stored once.  ``ReportSourceItem``
links that evidence to one or many issue numbers.  Base items may propose or
apply report values; adjustment items never rewrite a published print count and
instead carry independent settlement / supplemental-shipping deltas.
"""

from sqlalchemy import (
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class ReportSourceDocument(Base):
    __tablename__ = "report_source_documents"

    id = Column(Integer, primary_key=True, autoincrement=True)
    channel = Column(String(50), nullable=False, index=True)
    document_type = Column(String(30), nullable=False, index=True)
    original_filename = Column(String(255), nullable=False)
    display_name = Column(String(255), nullable=False)
    stored_path = Column(String(500), nullable=False)
    mime_type = Column(String(100), nullable=True)
    size = Column(Integer, nullable=False)
    sha256 = Column(String(64), nullable=False, index=True)
    source_date = Column(Date, nullable=True, index=True)
    # The issue page where the upload started.  Item mappings remain the
    # authoritative cross-issue links, while this anchor keeps a file visible
    # when OCR produced no rows (or no resolvable issue) yet.
    upload_issue_number = Column(Integer, nullable=True, index=True)
    extraction_status = Column(
        String(30), nullable=False, default="pending_review", server_default="pending_review", index=True
    )
    extraction_json = Column(JSON, nullable=True)
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    uploader = relationship("User", foreign_keys=[uploaded_by])
    items = relationship(
        "ReportSourceItem",
        back_populates="document",
        cascade="all, delete-orphan",
        order_by="ReportSourceItem.id",
    )


class ReportSourceItem(Base):
    __tablename__ = "report_source_items"

    id = Column(Integer, primary_key=True, autoincrement=True)
    document_id = Column(
        Integer,
        ForeignKey("report_source_documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Intentionally not an FK: monthly source files may reference a scheduled
    # future issue before the Issue row is created, and the evidence must remain
    # after an administrator deletes/recreates an issue.
    issue_number = Column(Integer, nullable=False, index=True)
    item_kind = Column(String(20), nullable=False, default="base", server_default="base", index=True)
    category = Column(String(50), nullable=False, index=True)
    sub_category = Column(String(100), nullable=False)
    source_label = Column(String(255), nullable=True)
    source_quantity = Column(Integer, nullable=True)
    applied_quantity = Column(Integer, nullable=True)
    source_status = Column(
        String(30), nullable=False, default="pending_review", server_default="pending_review", index=True
    )
    # Business role of this evidence.  Base and prepress additions contribute
    # to the editable print count; postpress actions affect only settlement /
    # supplemental shipping after the print count has been locked.
    source_action = Column(String(30), nullable=False, default="base", server_default="base", index=True)
    applied_phase = Column(
        String(30), nullable=False, default="pre_confirmation", server_default="pre_confirmation", index=True
    )
    print_delta = Column(Integer, nullable=False, default=0, server_default="0")
    effect_status = Column(String(20), nullable=False, default="active", server_default="active", index=True)
    supersedes_item_id = Column(
        Integer,
        ForeignKey("report_source_items.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    adjustment_kind = Column(String(30), nullable=True)
    settlement_delta = Column(Integer, nullable=False, default=0, server_default="0")
    shipping_delta = Column(Integer, nullable=False, default=0, server_default="0")
    shipped_quantity = Column(Integer, nullable=False, default=0, server_default="0")
    tracking_no = Column(String(100), nullable=True)
    shipped_at = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)
    confirmed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    confirmed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    document = relationship("ReportSourceDocument", back_populates="items")
    confirmer = relationship("User", foreign_keys=[confirmed_by])
    superseded_item = relationship(
        "ReportSourceItem",
        remote_side=[id],
        foreign_keys=[supersedes_item_id],
        backref="replacement_items",
    )

    __table_args__ = (
        UniqueConstraint(
            "document_id",
            "issue_number",
            "item_kind",
            "category",
            "sub_category",
            name="uq_report_source_item_mapping",
        ),
    )
