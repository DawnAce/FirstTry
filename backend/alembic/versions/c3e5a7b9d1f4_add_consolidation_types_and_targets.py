"""add consolidation types and immutable target batches

Revision ID: c3e5a7b9d1f4
Revises: b2d4f6a8c0e3
"""

from alembic import op
import sqlalchemy as sa


revision = "c3e5a7b9d1f4"
down_revision = "b2d4f6a8c0e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("shipping_deferrals", sa.Column("target_issue_number", sa.Integer(), nullable=True))
    op.add_column("shipping_deferrals", sa.Column("target_publish_date", sa.Date(), nullable=True))
    op.add_column("shipping_deferrals", sa.Column("consolidation_batch", sa.String(length=32), nullable=True))
    op.create_index(
        "ix_shipping_deferrals_target_issue_number",
        "shipping_deferrals",
        ["target_issue_number"],
    )
    op.create_index(
        "ix_shipping_deferrals_target_publish_date",
        "shipping_deferrals",
        ["target_publish_date"],
    )
    op.create_index(
        "ix_shipping_deferrals_consolidation_batch",
        "shipping_deferrals",
        ["consolidation_batch"],
    )


def downgrade() -> None:
    op.drop_index("ix_shipping_deferrals_consolidation_batch", table_name="shipping_deferrals")
    op.drop_index("ix_shipping_deferrals_target_publish_date", table_name="shipping_deferrals")
    op.drop_index("ix_shipping_deferrals_target_issue_number", table_name="shipping_deferrals")
    op.drop_column("shipping_deferrals", "consolidation_batch")
    op.drop_column("shipping_deferrals", "target_publish_date")
    op.drop_column("shipping_deferrals", "target_issue_number")
