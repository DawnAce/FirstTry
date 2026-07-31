"""add original report source documents and per-issue mappings

Revision ID: b9d1e3f5a7c2
Revises: a6c8e0f2b4d6
Create Date: 2026-07-31
"""

from alembic import op
import sqlalchemy as sa


revision = "b9d1e3f5a7c2"
down_revision = "a6c8e0f2b4d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "report_source_documents",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("channel", sa.String(length=50), nullable=False),
        sa.Column("document_type", sa.String(length=30), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("stored_path", sa.String(length=500), nullable=False),
        sa.Column("mime_type", sa.String(length=100), nullable=True),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("source_date", sa.Date(), nullable=True),
        sa.Column("extraction_status", sa.String(length=30), server_default="pending_review", nullable=False),
        sa.Column("extraction_json", sa.JSON(), nullable=True),
        sa.Column("uploaded_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_report_source_documents_channel"), "report_source_documents", ["channel"])
    op.create_index(op.f("ix_report_source_documents_document_type"), "report_source_documents", ["document_type"])
    op.create_index(op.f("ix_report_source_documents_extraction_status"), "report_source_documents", ["extraction_status"])
    op.create_index(op.f("ix_report_source_documents_sha256"), "report_source_documents", ["sha256"])
    op.create_index(op.f("ix_report_source_documents_source_date"), "report_source_documents", ["source_date"])

    op.create_table(
        "report_source_items",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("document_id", sa.Integer(), nullable=False),
        sa.Column("issue_number", sa.Integer(), nullable=False),
        sa.Column("item_kind", sa.String(length=20), server_default="base", nullable=False),
        sa.Column("category", sa.String(length=50), nullable=False),
        sa.Column("sub_category", sa.String(length=100), nullable=False),
        sa.Column("source_label", sa.String(length=255), nullable=True),
        sa.Column("source_quantity", sa.Integer(), nullable=True),
        sa.Column("applied_quantity", sa.Integer(), nullable=True),
        sa.Column("source_status", sa.String(length=30), server_default="pending_review", nullable=False),
        sa.Column("adjustment_kind", sa.String(length=30), nullable=True),
        sa.Column("settlement_delta", sa.Integer(), server_default="0", nullable=False),
        sa.Column("shipping_delta", sa.Integer(), server_default="0", nullable=False),
        sa.Column("shipped_quantity", sa.Integer(), server_default="0", nullable=False),
        sa.Column("tracking_no", sa.String(length=100), nullable=True),
        sa.Column("shipped_at", sa.DateTime(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("confirmed_by", sa.Integer(), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["confirmed_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["document_id"], ["report_source_documents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "document_id", "issue_number", "item_kind", "category", "sub_category",
            name="uq_report_source_item_mapping",
        ),
    )
    op.create_index(op.f("ix_report_source_items_category"), "report_source_items", ["category"])
    op.create_index(op.f("ix_report_source_items_document_id"), "report_source_items", ["document_id"])
    op.create_index(op.f("ix_report_source_items_issue_number"), "report_source_items", ["issue_number"])
    op.create_index(op.f("ix_report_source_items_item_kind"), "report_source_items", ["item_kind"])
    op.create_index(op.f("ix_report_source_items_source_status"), "report_source_items", ["source_status"])


def downgrade() -> None:
    op.drop_table("report_source_items")
    op.drop_table("report_source_documents")
