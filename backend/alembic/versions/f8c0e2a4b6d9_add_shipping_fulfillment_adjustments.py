"""add shipping fulfillment adjustments

Revision ID: f8c0e2a4b6d9
Revises: e0b2d4f6a8c1
"""

from alembic import op
import sqlalchemy as sa


revision = "f8c0e2a4b6d9"
down_revision = "e0b2d4f6a8c1"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "shipping_fulfillment_adjustments",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("issue_id", sa.Integer(), nullable=False),
        sa.Column("issue_number", sa.Integer(), nullable=False),
        sa.Column(
            "adjustment_type",
            sa.String(length=32),
            server_default="no_shipment_required",
            nullable=False,
        ),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(length=255), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["issue_id"], ["issues.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_shipping_fulfillment_adjustments_issue_id",
        "shipping_fulfillment_adjustments",
        ["issue_id"],
    )
    op.create_index(
        "ix_shipping_fulfillment_adjustments_issue_number",
        "shipping_fulfillment_adjustments",
        ["issue_number"],
    )
    op.create_index(
        "ix_shipping_fulfillment_adjustments_issue_type",
        "shipping_fulfillment_adjustments",
        ["issue_id", "adjustment_type"],
    )


def downgrade():
    op.drop_table("shipping_fulfillment_adjustments")
