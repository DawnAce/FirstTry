"""preserve follow-ups when deleting complaints

Revision ID: f6b8d0e2a4c7
Revises: e5a7c9b1d3f5
Create Date: 2026-07-23
"""

from alembic import op


revision = "f6b8d0e2a4c7"
down_revision = "e5a7c9b1d3f5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(
        "fk_postal_tickets_parent",
        "postal_tickets",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "fk_postal_tickets_parent",
        "postal_tickets",
        "postal_tickets",
        ["parent_ticket_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_postal_tickets_parent",
        "postal_tickets",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "fk_postal_tickets_parent",
        "postal_tickets",
        "postal_tickets",
        ["parent_ticket_id"],
        ["id"],
        ondelete="CASCADE",
    )
