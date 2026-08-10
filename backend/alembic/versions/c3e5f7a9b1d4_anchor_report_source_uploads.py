"""anchor report source uploads to their originating issue

Revision ID: c3e5f7a9b1d4
Revises: b1d3f5a7c9e2
"""

from alembic import op
import sqlalchemy as sa


revision = "c3e5f7a9b1d4"
down_revision = "b1d3f5a7c9e2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "report_source_documents",
        sa.Column("upload_issue_number", sa.Integer(), nullable=True),
    )
    op.create_index(
        "ix_report_source_documents_upload_issue_number",
        "report_source_documents",
        ["upload_issue_number"],
    )
    # Existing files already have item mappings.  The earliest linked issue is
    # the best recoverable origin and keeps every historical file visible.
    op.execute(
        sa.text(
            "UPDATE report_source_documents d "
            "SET upload_issue_number=("
            "SELECT MIN(i.issue_number) FROM report_source_items i "
            "WHERE i.document_id=d.id)"
        )
    )


def downgrade() -> None:
    op.drop_index(
        "ix_report_source_documents_upload_issue_number",
        table_name="report_source_documents",
    )
    op.drop_column("report_source_documents", "upload_issue_number")
