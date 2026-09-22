"""保存订单起投方式与起投刊期，不改写历史日期或价格。"""
from alembic import op
import sqlalchemy as sa

revision = "c9e1f3a5b7d0"
down_revision = "b8d0f2a4c6e9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("order_items", sa.Column("coverage_start_mode", sa.String(16), nullable=True))
    op.add_column("order_items", sa.Column("coverage_start_issue", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("order_items", "coverage_start_issue")
    op.drop_column("order_items", "coverage_start_mode")
