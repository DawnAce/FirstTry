"""attribute shipping fulfillment adjustments to plan details

Revision ID: f9d1e3a5c7b9
Revises: f8c0e2a4b6d9
"""

from alembic import op
import sqlalchemy as sa


revision = "f9d1e3a5c7b9"
down_revision = "f8c0e2a4b6d9"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "shipping_fulfillment_adjustments",
        sa.Column("shipping_detail_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "shipping_fulfillment_adjustments",
        sa.Column("detail_name_snapshot", sa.String(length=100), nullable=True),
    )
    op.add_column(
        "shipping_fulfillment_adjustments",
        sa.Column("detail_phone_snapshot", sa.String(length=50), nullable=True),
    )
    op.add_column(
        "shipping_fulfillment_adjustments",
        sa.Column("detail_address_snapshot", sa.Text(), nullable=True),
    )
    op.add_column(
        "shipping_fulfillment_adjustments",
        sa.Column("detail_channel_snapshot", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "shipping_fulfillment_adjustments",
        sa.Column("detail_company_snapshot", sa.String(length=100), nullable=True),
    )
    op.add_column(
        "shipping_fulfillment_adjustments",
        sa.Column("detail_quantity_snapshot", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_fulfillment_adjustment_shipping_detail",
        "shipping_fulfillment_adjustments",
        "shipping_details",
        ["shipping_detail_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_shipping_fulfillment_adjustments_shipping_detail_id",
        "shipping_fulfillment_adjustments",
        ["shipping_detail_id"],
    )


def downgrade():
    op.drop_index(
        "ix_shipping_fulfillment_adjustments_shipping_detail_id",
        table_name="shipping_fulfillment_adjustments",
    )
    op.drop_constraint(
        "fk_fulfillment_adjustment_shipping_detail",
        "shipping_fulfillment_adjustments",
        type_="foreignkey",
    )
    for column in [
        "detail_quantity_snapshot",
        "detail_company_snapshot",
        "detail_channel_snapshot",
        "detail_address_snapshot",
        "detail_phone_snapshot",
        "detail_name_snapshot",
        "shipping_detail_id",
    ]:
        op.drop_column("shipping_fulfillment_adjustments", column)
