"""drop shipping details city

Revision ID: 6e1b9c4d2a7f
Revises: 9d4a7b6c5e2f
Create Date: 2026-05-22 09:55:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6e1b9c4d2a7f'
down_revision: Union[str, None] = '9d4a7b6c5e2f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column('shipping_details', 'city')


def downgrade() -> None:
    op.add_column('shipping_details', sa.Column('city', sa.String(length=50), nullable=True))
