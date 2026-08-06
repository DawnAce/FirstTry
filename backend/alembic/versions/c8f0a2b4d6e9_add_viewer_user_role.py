"""add viewer user role

Revision ID: c8f0a2b4d6e9
Revises: c2e4f6a8b0d3
Create Date: 2026-08-05
"""

from alembic import op


revision = "c8f0a2b4d6e9"
down_revision = "c2e4f6a8b0d3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users MODIFY COLUMN role "
        "ENUM('admin','operator','viewer') NOT NULL DEFAULT 'operator'"
    )


def downgrade() -> None:
    op.execute("UPDATE users SET role = 'operator' WHERE role = 'viewer'")
    op.execute(
        "ALTER TABLE users MODIFY COLUMN role "
        "ENUM('admin','operator') NOT NULL DEFAULT 'operator'"
    )
