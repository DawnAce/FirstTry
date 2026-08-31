"""add waybill documents and consolidation preview

Revision ID: e7b9c1d3f5a8
Revises: e6a8c0d2f4b7
"""

from alembic import op
import sqlalchemy as sa


revision = "e7b9c1d3f5a8"
down_revision = "e6a8c0d2f4b7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "shipping_waybill_import_rows",
        sa.Column("consolidation_deferral_ids", sa.JSON(), nullable=True),
    )
    op.add_column(
        "shipping_waybill_import_rows",
        sa.Column("consolidation_issue_numbers", sa.JSON(), nullable=True),
    )
    op.add_column(
        "shipping_waybill_import_rows",
        sa.Column("consolidation_quantity", sa.Integer(), server_default="0", nullable=False),
    )
    op.create_table(
        "shipping_waybill_import_documents",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("batch_id", sa.Integer(), nullable=False),
        sa.Column("linked_import_row_id", sa.Integer(), nullable=True),
        sa.Column("shipping_package_id", sa.Integer(), nullable=True),
        sa.Column("document_type", sa.String(length=50), nullable=False),
        sa.Column("source_sheet", sa.String(length=100), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("extracted_data", sa.JSON(), nullable=True),
        sa.Column("validation_errors", sa.JSON(), nullable=True),
        sa.Column("parser_version", sa.String(length=32), server_default="1", nullable=False),
        sa.Column("checked_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["batch_id"], ["shipping_waybill_import_batches.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["linked_import_row_id"], ["shipping_waybill_import_rows.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["shipping_package_id"], ["shipping_packages.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_shipping_waybill_import_documents_batch_id",
        "shipping_waybill_import_documents",
        ["batch_id"],
    )
    op.create_index(
        "ix_shipping_waybill_import_documents_linked_import_row_id",
        "shipping_waybill_import_documents",
        ["linked_import_row_id"],
    )
    op.create_index(
        "ix_shipping_waybill_import_documents_shipping_package_id",
        "shipping_waybill_import_documents",
        ["shipping_package_id"],
    )
    op.create_index(
        "ix_shipping_waybill_import_documents_document_type",
        "shipping_waybill_import_documents",
        ["document_type"],
    )
    op.create_index(
        "ix_shipping_waybill_import_documents_status",
        "shipping_waybill_import_documents",
        ["status"],
    )


def downgrade() -> None:
    op.drop_table("shipping_waybill_import_documents")
    op.drop_column("shipping_waybill_import_rows", "consolidation_quantity")
    op.drop_column("shipping_waybill_import_rows", "consolidation_issue_numbers")
    op.drop_column("shipping_waybill_import_rows", "consolidation_deferral_ids")
