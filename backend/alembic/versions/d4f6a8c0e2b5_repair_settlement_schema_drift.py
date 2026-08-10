"""repair settlement schema drift on databases stamped past the workflow migration

Revision ID: d4f6a8c0e2b5
Revises: c3e5f7a9b1d4

Some long-lived development databases were stamped beyond ``c2e4f6a8b0d3``
without receiving that revision's settlement columns.  A normal ``upgrade
head`` therefore reported success while settlement writes failed with unknown
column errors.  This reconciliation migration is deliberately idempotent: a
correctly migrated database is unchanged, while a drifted database receives
only the missing columns, indexes, and backfill.
"""

from datetime import datetime

from alembic import op
import sqlalchemy as sa


revision = "d4f6a8c0e2b5"
down_revision = "c3e5f7a9b1d4"
branch_labels = None
depends_on = None


def _month(value) -> str:
    if isinstance(value, datetime):
        return value.strftime("%Y%m")
    text = str(value or "")
    digits = "".join(character for character in text[:10] if character.isdigit())
    return digits[:6] if len(digits) >= 6 else "202608"


def _column_names(inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def _index_names(inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    settlement_columns = _column_names(inspector, "channel_settlements")

    missing_settlement_columns = {
        "party_type": sa.Column(
            "party_type",
            sa.Enum("channel", "individual", name="settlementpartytype"),
            server_default="channel",
            nullable=False,
        ),
        "settlement_type": sa.Column(
            "settlement_type",
            sa.Enum("consignment", "buyout", name="settlementtype"),
            nullable=True,
        ),
        # Keep system_no nullable until every historical row is backfilled.
        "system_no": sa.Column("system_no", sa.String(64), nullable=True),
        "external_no": sa.Column("external_no", sa.String(128), nullable=True),
        "invoice_status": sa.Column(
            "invoice_status",
            sa.Enum("unissued", "issued", name="settlementinvoicestatus"),
            server_default="unissued",
            nullable=False,
        ),
        "payment_status": sa.Column(
            "payment_status",
            sa.Enum("unpaid", "partial", "paid", name="settlementpaymentstatus"),
            server_default="unpaid",
            nullable=False,
        ),
        "recognition_source_filename": sa.Column(
            "recognition_source_filename", sa.String(255), nullable=True
        ),
        "recognition_parser_version": sa.Column(
            "recognition_parser_version", sa.String(32), nullable=True
        ),
        "recognition_result": sa.Column("recognition_result", sa.JSON(), nullable=True),
    }
    for name, column in missing_settlement_columns.items():
        if name not in settlement_columns:
            op.add_column("channel_settlements", column)

    # Backfill both fully drifted and partially repaired databases.  Preserve
    # any values that were already written successfully.
    rows = connection.execute(
        sa.text(
            "SELECT id, created_at, party_type, system_no "
            "FROM channel_settlements ORDER BY id"
        )
    ).mappings()
    for row in rows:
        if not row["system_no"]:
            prefix = "GR" if row["party_type"] == "individual" else "QD"
            system_no = f"JS-{prefix}-{_month(row['created_at'])}-{row['id']:06d}"
            connection.execute(
                sa.text(
                    "UPDATE channel_settlements SET system_no=:system_no "
                    "WHERE id=:settlement_id"
                ),
                {"system_no": system_no, "settlement_id": row["id"]},
            )

    backfills: list[str] = []
    if "external_no" not in settlement_columns:
        backfills.append("external_no=settlement_no")
    if "invoice_status" not in settlement_columns:
        backfills.append(
            "invoice_status=CASE WHEN invoice_received=1 THEN 'issued' ELSE 'unissued' END"
        )
    if "payment_status" not in settlement_columns:
        backfills.append(
            "payment_status=CASE "
            "WHEN COALESCE(paid_amount, 0) <= 0 THEN 'unpaid' "
            "WHEN amount_due IS NOT NULL AND paid_amount >= amount_due THEN 'paid' "
            "ELSE 'partial' END"
        )
    if backfills:
        connection.execute(
            sa.text("UPDATE channel_settlements SET " + ", ".join(backfills))
        )

    # Refresh inspection after the conditional DDL above.
    inspector = sa.inspect(connection)
    system_no_column = next(
        column
        for column in inspector.get_columns("channel_settlements")
        if column["name"] == "system_no"
    )
    if system_no_column["nullable"]:
        op.alter_column(
            "channel_settlements",
            "system_no",
            existing_type=sa.String(64),
            nullable=False,
        )

    inspector = sa.inspect(connection)
    settlement_indexes = _index_names(inspector, "channel_settlements")
    if "ux_settlements_settlement_no" in settlement_indexes:
        op.drop_index("ux_settlements_settlement_no", table_name="channel_settlements")
    if "ux_settlements_system_no" not in settlement_indexes:
        op.create_index(
            "ux_settlements_system_no",
            "channel_settlements",
            ["system_no"],
            unique=True,
        )
    if "ix_settlements_external_no" not in settlement_indexes:
        op.create_index(
            "ix_settlements_external_no",
            "channel_settlements",
            ["external_no"],
            unique=False,
        )

    inspector = sa.inspect(connection)
    attachment_columns = _column_names(inspector, "settlement_attachments")
    if "file_size" not in attachment_columns:
        op.add_column(
            "settlement_attachments", sa.Column("file_size", sa.Integer(), nullable=True)
        )
    if "sha256" not in attachment_columns:
        op.add_column(
            "settlement_attachments", sa.Column("sha256", sa.String(64), nullable=True)
        )

    inspector = sa.inspect(connection)
    attachment_indexes = _index_names(inspector, "settlement_attachments")
    if "ix_settlement_attachments_sha256" not in attachment_indexes:
        op.create_index(
            "ix_settlement_attachments_sha256",
            "settlement_attachments",
            ["sha256"],
            unique=False,
        )


def downgrade() -> None:
    # This revision repairs schema that belongs to c2e4f6a8b0d3.  Removing it
    # here would also damage databases where that original migration ran
    # correctly, so downgrade intentionally changes only the Alembic version.
    pass
