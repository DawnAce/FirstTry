"""add invoice_tax_no and invoice_recipient_email to orders

V1.1 增强：把现有"发票抬头"单字段拆分成「抬头 / 税号 / 接收邮箱」三个独立字段，
方便后续生成 / 推送电子发票，避免运营把多重信息塞进单一字段或备注里。

* `invoice_tax_no` (VARCHAR 64) — 纳税人识别号 / 统一社会信用代码（个人发票可空）
* `invoice_recipient_email` (VARCHAR 128) — 电子发票送达邮箱

已存在的 `invoice_title` 列不动；现有数据保持原样，由运营在后续编辑时手动拆分。

Revision ID: e9b3c5d7f1a4
Revises: d8a1f4e7b9c2
Create Date: 2026-06-02 17:30:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "e9b3c5d7f1a4"
down_revision = "d8a1f4e7b9c2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "orders",
        sa.Column("invoice_tax_no", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "orders",
        sa.Column("invoice_recipient_email", sa.String(length=128), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("orders", "invoice_recipient_email")
    op.drop_column("orders", "invoice_tax_no")
