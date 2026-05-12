"""add destination to report data

Revision ID: 8f3c2a1b5d7e
Revises: 24709c379498
Create Date: 2026-05-12 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8f3c2a1b5d7e'
down_revision: Union[str, None] = '24709c379498'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('report_entries', sa.Column('destination', sa.String(length=50), nullable=True))
    op.add_column('report_item_templates', sa.Column('destination', sa.String(length=50), nullable=True))


def downgrade() -> None:
    op.drop_column('report_item_templates', 'destination')
    op.drop_column('report_entries', 'destination')
