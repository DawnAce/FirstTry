"""backfill Mafei warehouse retention as stock-in adjustments

Revision ID: b2d4f6a8c0e3
Revises: a2c4e6f8b0d3
"""

from alembic import op
import sqlalchemy as sa


revision = "b2d4f6a8c0e3"
down_revision = "a2c4e6f8b0d3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("""
        UPDATE shipping_fulfillment_adjustments
        SET adjustment_type = 'warehouse_stock_in',
            reason = '转库留存 · 当期报纸入马飞中通库房备货'
        WHERE shipping_detail_id IN (
            SELECT id FROM shipping_details
            WHERE TRIM(name) = '马飞' AND TRIM(channel) = '库房留存'
        )
        OR (
            TRIM(COALESCE(detail_name_snapshot, '')) = '马飞'
            AND TRIM(COALESCE(detail_channel_snapshot, '')) = '库房留存'
        )
    """))


def downgrade() -> None:
    op.execute(sa.text("""
        UPDATE shipping_fulfillment_adjustments
        SET adjustment_type = 'no_shipment_required'
        WHERE adjustment_type = 'warehouse_stock_in'
    """))
