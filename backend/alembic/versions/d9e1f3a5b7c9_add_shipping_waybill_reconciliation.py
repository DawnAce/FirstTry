"""add shipping waybill reconciliation

Revision ID: d9e1f3a5b7c9
Revises: c8f0a2b4d6e9
"""

from alembic import op
import sqlalchemy as sa


revision = "d9e1f3a5b7c9"
down_revision = "c8f0a2b4d6e9"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "shipping_details",
        sa.Column("shipping_requirement", sa.String(length=32), server_default="tracking_required", nullable=False),
    )
    op.create_index("ix_shipping_details_shipping_requirement", "shipping_details", ["shipping_requirement"])

    op.create_table(
        "shipping_waybill_import_batches",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("issue_id", sa.Integer(), nullable=False),
        sa.Column("issue_number", sa.Integer(), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("file_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("expected_quantity", sa.Integer(), nullable=False),
        sa.Column("parsed_quantity", sa.Integer(), nullable=False),
        sa.Column("matched_quantity", sa.Integer(), nullable=False),
        sa.Column("pending_quantity", sa.Integer(), nullable=False),
        sa.Column("extra_quantity", sa.Integer(), nullable=False),
        sa.Column("matched_rows", sa.Integer(), nullable=False),
        sa.Column("unmatched_rows", sa.Integer(), nullable=False),
        sa.Column("warning_count", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["issue_id"], ["issues.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_shipping_waybill_import_batches_issue_id", "shipping_waybill_import_batches", ["issue_id"])
    op.create_index("ix_shipping_waybill_import_batches_issue_number", "shipping_waybill_import_batches", ["issue_number"])
    op.create_index(
        "uq_waybill_import_issue_hash",
        "shipping_waybill_import_batches",
        ["issue_number", "file_hash"],
        unique=True,
    )

    op.create_table(
        "shipping_waybill_import_rows",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("batch_id", sa.Integer(), nullable=False),
        sa.Column("source_sheet", sa.String(length=100), nullable=False),
        sa.Column("source_row", sa.Integer(), nullable=False),
        sa.Column("carrier", sa.String(length=50), nullable=False),
        sa.Column("tracking_no", sa.String(length=100), nullable=True),
        sa.Column("recipient_name", sa.String(length=100), nullable=False),
        sa.Column("phone", sa.String(length=50), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("no_tracking_required", sa.Boolean(), nullable=False),
        sa.Column("match_status", sa.String(length=20), nullable=False),
        sa.Column("match_reason", sa.String(length=255), nullable=True),
        sa.Column("shipping_detail_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["batch_id"], ["shipping_waybill_import_batches.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["shipping_detail_id"], ["shipping_details.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_shipping_waybill_import_rows_batch_id", "shipping_waybill_import_rows", ["batch_id"])
    op.create_index("ix_shipping_waybill_import_rows_shipping_detail_id", "shipping_waybill_import_rows", ["shipping_detail_id"])

    op.create_table(
        "shipping_packages",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("shipping_detail_id", sa.Integer(), nullable=False),
        sa.Column("import_row_id", sa.Integer(), nullable=True),
        sa.Column("carrier", sa.String(length=50), nullable=False),
        sa.Column("tracking_no", sa.String(length=100), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("shipped_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["import_row_id"], ["shipping_waybill_import_rows.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["shipping_detail_id"], ["shipping_details.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("import_row_id"),
    )
    op.create_index("ix_shipping_packages_shipping_detail_id", "shipping_packages", ["shipping_detail_id"])
    op.create_index(
        "uq_shipping_package_carrier_tracking",
        "shipping_packages",
        ["carrier", "tracking_no"],
        unique=True,
    )


def downgrade():
    op.drop_table("shipping_packages")
    op.drop_table("shipping_waybill_import_rows")
    op.drop_table("shipping_waybill_import_batches")
    op.drop_index("ix_shipping_details_shipping_requirement", table_name="shipping_details")
    op.drop_column("shipping_details", "shipping_requirement")
