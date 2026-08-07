"""add shipping deferrals and cross-issue package allocations

Revision ID: a0c2e4f6b8d1
Revises: f9d1e3a5c7b9
"""

from alembic import op
import sqlalchemy as sa


revision = "a0c2e4f6b8d1"
down_revision = "f9d1e3a5c7b9"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "shipping_deferrals",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("issue_id", sa.Integer(), nullable=False),
        sa.Column("issue_number", sa.Integer(), nullable=False),
        sa.Column("shipping_detail_id", sa.Integer(), nullable=True),
        sa.Column("deferral_type", sa.String(length=32), nullable=False, server_default="month_end_consolidation"),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("fulfilled_package_id", sa.Integer(), nullable=True),
        sa.Column("detail_name_snapshot", sa.String(length=100), nullable=True),
        sa.Column("detail_phone_snapshot", sa.String(length=50), nullable=True),
        sa.Column("detail_address_snapshot", sa.Text(), nullable=True),
        sa.Column("detail_channel_snapshot", sa.String(length=255), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("fulfilled_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["issue_id"], ["issues.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["shipping_detail_id"], ["shipping_details.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["fulfilled_package_id"], ["shipping_packages.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_shipping_deferrals_issue_id", "shipping_deferrals", ["issue_id"])
    op.create_index("ix_shipping_deferrals_issue_number", "shipping_deferrals", ["issue_number"])
    op.create_index("ix_shipping_deferrals_shipping_detail_id", "shipping_deferrals", ["shipping_detail_id"])
    op.create_index("ix_shipping_deferrals_status", "shipping_deferrals", ["status"])
    op.create_index("ix_shipping_deferrals_fulfilled_package_id", "shipping_deferrals", ["fulfilled_package_id"])
    op.create_index("ix_shipping_deferrals_issue_status", "shipping_deferrals", ["issue_id", "status"])
    op.create_index("ix_shipping_deferrals_detail_status", "shipping_deferrals", ["shipping_detail_id", "status"])

    op.create_table(
        "shipping_package_allocations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("shipping_package_id", sa.Integer(), nullable=False),
        sa.Column("shipping_detail_id", sa.Integer(), nullable=False),
        sa.Column("deferral_id", sa.Integer(), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["shipping_package_id"], ["shipping_packages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["shipping_detail_id"], ["shipping_details.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["deferral_id"], ["shipping_deferrals.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("deferral_id", name="uq_shipping_package_allocations_deferral_id"),
    )
    op.create_index("ix_shipping_package_allocations_shipping_package_id", "shipping_package_allocations", ["shipping_package_id"])
    op.create_index("ix_shipping_package_allocations_shipping_detail_id", "shipping_package_allocations", ["shipping_detail_id"])
    op.create_index(
        "uq_shipping_package_allocation_detail",
        "shipping_package_allocations",
        ["shipping_package_id", "shipping_detail_id"],
        unique=True,
    )


def downgrade():
    op.drop_table("shipping_package_allocations")
    op.drop_table("shipping_deferrals")
