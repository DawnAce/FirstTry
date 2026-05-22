"""add publication schedule uploads

Revision ID: 3f2b7a9c1d0e
Revises: 6e1b9c4d2a7f
Create Date: 2026-05-22 15:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "3f2b7a9c1d0e"
down_revision: Union[str, None] = "6e1b9c4d2a7f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "publication_schedule_uploads",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("stored_path", sa.String(length=500), nullable=False),
        sa.Column(
            "status",
            sa.Enum("previewed", "committed", "failed", name="publicationscheduleuploadstatus"),
            nullable=False,
        ),
        sa.Column("summary_json", sa.JSON(), nullable=True),
        sa.Column("error_json", sa.JSON(), nullable=True),
        sa.Column("uploaded_by", sa.String(length=50), nullable=True),
        sa.Column("raw_text", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=True),
        sa.Column("committed_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_publication_schedule_uploads_status"), "publication_schedule_uploads", ["status"], unique=False)
    op.create_index(op.f("ix_publication_schedule_uploads_year"), "publication_schedule_uploads", ["year"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_publication_schedule_uploads_year"), table_name="publication_schedule_uploads")
    op.drop_index(op.f("ix_publication_schedule_uploads_status"), table_name="publication_schedule_uploads")
    op.drop_table("publication_schedule_uploads")
