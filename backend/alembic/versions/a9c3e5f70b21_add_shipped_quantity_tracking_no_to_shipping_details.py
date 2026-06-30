"""add shipped_quantity + tracking_no to shipping_details

已发货回写（write-back）：发货明细补「实发份数」与「运单号」两列，用于「应发 vs 实发」
对账。两列可空、加在表尾，旧行干净升级；「已发」标记仍复用现有 ``shipped_at``。

Revision ID: a9c3e5f70b21
Revises: f7a2c4e6b8d0
Create Date: 2026-06-28
"""

from alembic import op
import sqlalchemy as sa


revision = "a9c3e5f70b21"
down_revision = "f7a2c4e6b8d0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "shipping_details", sa.Column("shipped_quantity", sa.Integer(), nullable=True)
    )
    op.add_column(
        "shipping_details", sa.Column("tracking_no", sa.String(length=64), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("shipping_details", "tracking_no")
    op.drop_column("shipping_details", "shipped_quantity")
