"""add optional electronic invoice attachments

Revision ID: c0e2f4a6b8d1
Revises: b9d1e3f5a7c2
Create Date: 2026-08-03
"""

from alembic import op
import sqlalchemy as sa


revision = "c0e2f4a6b8d1"
down_revision = "b9d1e3f5a7c2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("invoices", sa.Column("attachment_filename", sa.String(length=255), nullable=True))
    op.add_column("invoices", sa.Column("attachment_path", sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column("invoices", "attachment_path")
    op.drop_column("invoices", "attachment_filename")
