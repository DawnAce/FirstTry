"""expand settlement numbering, recognition and workflow

Revision ID: c2e4f6a8b0d3
Revises: b6d8f0a2c4e7
Create Date: 2026-08-05
"""

from datetime import datetime

from alembic import op
import sqlalchemy as sa


revision = "c2e4f6a8b0d3"
down_revision = "b6d8f0a2c4e7"
branch_labels = None
depends_on = None


def _month(value) -> str:
    if isinstance(value, datetime):
        return value.strftime("%Y%m")
    text = str(value or "")
    digits = "".join(character for character in text[:10] if character.isdigit())
    return digits[:6] if len(digits) >= 6 else "202608"


def upgrade() -> None:
    party_enum = sa.Enum("channel", "individual", name="settlementpartytype")
    type_enum = sa.Enum("consignment", "buyout", name="settlementtype")
    invoice_enum = sa.Enum("unissued", "issued", name="settlementinvoicestatus")
    payment_enum = sa.Enum("unpaid", "partial", "paid", name="settlementpaymentstatus")

    op.add_column(
        "channel_settlements",
        sa.Column("party_type", party_enum, server_default="channel", nullable=False),
    )
    op.add_column("channel_settlements", sa.Column("settlement_type", type_enum, nullable=True))
    op.add_column("channel_settlements", sa.Column("system_no", sa.String(64), nullable=True))
    op.add_column("channel_settlements", sa.Column("external_no", sa.String(128), nullable=True))
    op.add_column(
        "channel_settlements",
        sa.Column("invoice_status", invoice_enum, server_default="unissued", nullable=False),
    )
    op.add_column(
        "channel_settlements",
        sa.Column("payment_status", payment_enum, server_default="unpaid", nullable=False),
    )
    op.add_column(
        "channel_settlements",
        sa.Column("recognition_source_filename", sa.String(255), nullable=True),
    )
    op.add_column(
        "channel_settlements",
        sa.Column("recognition_parser_version", sa.String(32), nullable=True),
    )
    op.add_column(
        "channel_settlements",
        sa.Column("recognition_result", sa.JSON(), nullable=True),
    )

    connection = op.get_bind()
    rows = connection.execute(
        sa.text("SELECT id, created_at FROM channel_settlements ORDER BY id")
    ).mappings()
    for row in rows:
        system_no = f"JS-QD-{_month(row['created_at'])}-{row['id']:06d}"
        connection.execute(
            sa.text(
                "UPDATE channel_settlements "
                "SET system_no=:system_no, external_no=settlement_no, "
                "invoice_status=CASE WHEN invoice_received=1 THEN 'issued' ELSE 'unissued' END, "
                "payment_status=CASE "
                "WHEN COALESCE(paid_amount, 0) <= 0 THEN 'unpaid' "
                "WHEN amount_due IS NOT NULL AND paid_amount >= amount_due THEN 'paid' "
                "ELSE 'partial' END "
                "WHERE id=:settlement_id"
            ),
            {"system_no": system_no, "settlement_id": row["id"]},
        )
    op.alter_column(
        "channel_settlements",
        "system_no",
        existing_type=sa.String(64),
        nullable=False,
    )
    op.drop_index("ux_settlements_settlement_no", table_name="channel_settlements")
    op.create_index(
        "ux_settlements_system_no",
        "channel_settlements",
        ["system_no"],
        unique=True,
    )
    op.create_index(
        "ix_settlements_external_no",
        "channel_settlements",
        ["external_no"],
        unique=False,
    )

    op.add_column(
        "settlement_attachments", sa.Column("file_size", sa.Integer(), nullable=True)
    )
    op.add_column(
        "settlement_attachments", sa.Column("sha256", sa.String(64), nullable=True)
    )
    op.create_index(
        "ix_settlement_attachments_sha256",
        "settlement_attachments",
        ["sha256"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_settlement_attachments_sha256", table_name="settlement_attachments")
    op.drop_column("settlement_attachments", "sha256")
    op.drop_column("settlement_attachments", "file_size")

    op.drop_index("ix_settlements_external_no", table_name="channel_settlements")
    op.drop_index("ux_settlements_system_no", table_name="channel_settlements")
    op.create_index(
        "ux_settlements_settlement_no",
        "channel_settlements",
        ["settlement_no"],
        unique=True,
    )
    for column in (
        "recognition_result",
        "recognition_parser_version",
        "recognition_source_filename",
        "payment_status",
        "invoice_status",
        "external_no",
        "system_no",
        "settlement_type",
        "party_type",
    ):
        op.drop_column("channel_settlements", column)
