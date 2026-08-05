"""sync applied postal addresses to fulfillment targets

Revision ID: f3b5d7e9a1c4
Revises: e2a4c6f8b0d2
Create Date: 2026-08-05

Repair orders created after a postal address change had already been applied.
The postal delivery is the current effective recipient source; the target may
still contain the older checkout snapshot.
"""

from typing import Sequence, Union

from alembic import op


revision: str = "f3b5d7e9a1c4"
down_revision: Union[str, None] = "e2a4c6f8b0d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _delivery_value(column: str) -> str:
    return f"""(
        SELECT pd.{column}
        FROM postal_delivery pd
        JOIN postal_tickets pt ON pt.postal_delivery_id = pd.id
        WHERE pd.fulfillment_target_id = fulfillment_targets.id
          AND pt.type = 'address'
          AND pt.applied_to_order = 1
        ORDER BY pd.year DESC, pd.id DESC
        LIMIT 1
    )"""


def upgrade() -> None:
    op.execute(f"""
        UPDATE fulfillment_targets
        SET recipient_name = COALESCE({_delivery_value('recipient_name')}, recipient_name),
            recipient_phone = COALESCE({_delivery_value('recipient_phone')}, recipient_phone),
            recipient_address = COALESCE({_delivery_value('recipient_address')}, recipient_address),
            recipient_postal_code = COALESCE({_delivery_value('recipient_postal_code')}, recipient_postal_code)
        WHERE EXISTS (
            SELECT 1
            FROM postal_delivery pd
            JOIN postal_tickets pt ON pt.postal_delivery_id = pd.id
            WHERE pd.fulfillment_target_id = fulfillment_targets.id
              AND pt.type = 'address'
              AND pt.applied_to_order = 1
        )
    """)


def downgrade() -> None:
    # The former target snapshot cannot be reconstructed reliably.
    pass
