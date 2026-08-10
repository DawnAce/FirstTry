"""settlement details workflow and channel sales-mode policy

Revision ID: b1d3f5a7c9e2
Revises: a0c2e4f6b8d1
"""

from alembic import op
import sqlalchemy as sa


revision = "b1d3f5a7c9e2"
down_revision = "a0c2e4f6b8d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    policy_enum = sa.Enum(
        "not_applicable", "optional", "required", name="salesmodepolicy"
    )
    op.add_column(
        "partners",
        sa.Column(
            "sales_mode_policy",
            policy_enum,
            server_default="not_applicable",
            nullable=False,
        ),
    )
    op.execute(
        sa.text(
            "UPDATE partners SET sales_mode_policy='required' "
            "WHERE REPLACE(name, ' ', '') LIKE '%北京报刊零售%' "
            "OR REPLACE(name, ' ', '') LIKE '%北京报零%'"
        )
    )

    op.add_column(
        "channel_settlements", sa.Column("invoice_date", sa.Date(), nullable=True)
    )
    op.add_column(
        "settlement_attachments",
        sa.Column("is_primary", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column(
        "settlement_attachments", sa.Column("recognized", sa.Boolean(), nullable=True)
    )
    op.add_column(
        "settlement_attachments",
        sa.Column("recognition_parser_version", sa.String(32), nullable=True),
    )
    op.add_column(
        "settlement_attachments",
        sa.Column("recognition_result", sa.JSON(), nullable=True),
    )

    connection = op.get_bind()
    rows = connection.execute(
        sa.text(
            "SELECT settlement_id, MIN(id) AS attachment_id "
            "FROM settlement_attachments WHERE category='settlement_sheet' "
            "GROUP BY settlement_id"
        )
    ).mappings()
    for row in rows:
        connection.execute(
            sa.text(
                "UPDATE settlement_attachments SET is_primary=1 "
                "WHERE id=:attachment_id"
            ),
            {"attachment_id": row["attachment_id"]},
        )


def downgrade() -> None:
    op.drop_column("settlement_attachments", "recognition_result")
    op.drop_column("settlement_attachments", "recognition_parser_version")
    op.drop_column("settlement_attachments", "recognized")
    op.drop_column("settlement_attachments", "is_primary")
    op.drop_column("channel_settlements", "invoice_date")
    op.drop_column("partners", "sales_mode_policy")
