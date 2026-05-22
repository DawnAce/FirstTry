"""add publication schedule upload rows json

Revision ID: 8c4f2d1e9b7a
Revises: 3f2b7a9c1d0e
Create Date: 2026-05-22 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "8c4f2d1e9b7a"
down_revision: Union[str, None] = "3f2b7a9c1d0e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "publication_schedule_uploads",
        sa.Column("rows_json", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("publication_schedule_uploads", "rows_json")
