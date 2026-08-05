"""backfill postal ticket order links from their deliveries

Revision ID: e2a4c6f8b0d2
Revises: d1f3a5c7e9b2
Create Date: 2026-08-05

Postal tickets may be imported before an order exists.  The later delivery
back-link used to update only ``postal_delivery``, leaving the denormalised
``postal_tickets.order_id`` empty and hiding the tickets on the order page.
"""

from typing import Sequence, Union

from alembic import op


revision: str = "e2a4c6f8b0d2"
down_revision: Union[str, None] = "d1f3a5c7e9b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE postal_tickets
        SET order_id = (
            SELECT postal_delivery.order_id
            FROM postal_delivery
            WHERE postal_delivery.id = postal_tickets.postal_delivery_id
        )
        WHERE postal_delivery_id IS NOT NULL
          AND EXISTS (
              SELECT 1
              FROM postal_delivery
              WHERE postal_delivery.id = postal_tickets.postal_delivery_id
          )
        """
    )


def downgrade() -> None:
    # Data repair is intentionally irreversible: the previous values cannot be
    # distinguished from links created legitimately after this migration.
    pass
