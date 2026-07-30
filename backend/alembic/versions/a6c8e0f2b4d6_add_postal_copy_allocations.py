"""add postal address-change copy allocations

Revision ID: a6c8e0f2b4d6
Revises: e3f5a7c9b1d4
Create Date: 2026-07-30
"""

from alembic import op
import sqlalchemy as sa


revision = "a6c8e0f2b4d6"
down_revision = "e3f5a7c9b1d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("postal_tickets", sa.Column("copy_allocations", sa.JSON(), nullable=True))
    op.add_column(
        "postal_tickets",
        sa.Column("unresolved_copies", sa.Integer(), server_default="0", nullable=False),
    )
    op.execute(sa.text(
        "UPDATE postal_tickets "
        "SET unresolved_copies = old_copies - new_copies "
        "WHERE type = 'address' AND old_copies IS NOT NULL "
        "AND new_copies IS NOT NULL AND old_copies > new_copies"
    ))
    op.create_index(
        "ix_postal_tickets_unresolved_copies",
        "postal_tickets",
        ["unresolved_copies"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_postal_tickets_unresolved_copies", table_name="postal_tickets")
    op.drop_column("postal_tickets", "unresolved_copies")
    op.drop_column("postal_tickets", "copy_allocations")
