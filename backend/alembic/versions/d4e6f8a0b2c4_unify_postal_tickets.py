"""unify postal complaints, address changes and follow-ups

Revision ID: d4e6f8a0b2c4
Revises: c3d5e7f9a1b3
Create Date: 2026-07-22
"""

from datetime import date, datetime, time

from alembic import op
import sqlalchemy as sa


revision = "d4e6f8a0b2c4"
down_revision = "c3d5e7f9a1b3"
branch_labels = None
depends_on = None


TICKET_TYPE = sa.Enum("complaint", "address", "follow", name="postaltickettype")
COMPLAINT_STATUS = sa.Enum(
    "open", "in_progress", "resolved", name="postalcomplaintstatus"
)
EVENT_TYPE = sa.Enum(
    "handling", "follow_up", "address_applied", name="postalticketeventtype"
)


def _create_unified_tables() -> None:
    op.create_table(
        "postal_tickets",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("type", TICKET_TYPE, nullable=False),
        sa.Column("postal_delivery_id", sa.Integer(), nullable=True),
        sa.Column("order_id", sa.Integer(), nullable=True),
        sa.Column("external_order_no", sa.String(length=64), nullable=True),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("complaint_date", sa.Date(), nullable=True),
        sa.Column("missing_issues", sa.Text(), nullable=True),
        sa.Column("handling", sa.Text(), nullable=True),
        sa.Column("routed_label", sa.String(length=64), nullable=True),
        sa.Column("routed_unit_id", sa.Integer(), nullable=True),
        sa.Column("follow_up", sa.Text(), nullable=True),
        sa.Column("handling_count", sa.Integer(), nullable=True),
        sa.Column("status", COMPLAINT_STATUS, nullable=True),
        sa.Column("first_handler", sa.String(length=64), nullable=True),
        sa.Column("snap_name", sa.String(length=128), nullable=True),
        sa.Column("snap_phone", sa.String(length=64), nullable=True),
        sa.Column("snap_address", sa.Text(), nullable=True),
        sa.Column("snap_postal_code", sa.String(length=20), nullable=True),
        sa.Column("change_date", sa.Date(), nullable=True),
        sa.Column("old_name", sa.String(length=128), nullable=True),
        sa.Column("old_phone", sa.String(length=64), nullable=True),
        sa.Column("old_address", sa.Text(), nullable=True),
        sa.Column("old_copies", sa.Integer(), nullable=True),
        sa.Column("new_name", sa.String(length=128), nullable=True),
        sa.Column("new_phone", sa.String(length=64), nullable=True),
        sa.Column("new_address", sa.Text(), nullable=True),
        sa.Column("new_copies", sa.Integer(), nullable=True),
        sa.Column("original_start_month", sa.String(length=16), nullable=True),
        sa.Column("effective_start_month", sa.String(length=16), nullable=True),
        sa.Column(
            "applied_to_order",
            sa.Boolean(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("applied_by", sa.Integer(), nullable=True),
        sa.Column("applied_at", sa.DateTime(), nullable=True),
        sa.Column("follow_up_date", sa.Date(), nullable=True),
        sa.Column("batch_label", sa.String(length=32), nullable=True),
        sa.Column("result", sa.Text(), nullable=True),
        sa.Column("parent_ticket_id", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["postal_delivery_id"], ["postal_delivery.id"],
            name="fk_postal_tickets_delivery", ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["order_id"], ["orders.id"],
            name="fk_postal_tickets_order", ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["routed_unit_id"], ["partners.id"],
            name="fk_postal_tickets_routed_unit", ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["applied_by"], ["users.id"], name="fk_postal_tickets_applied_by"
        ),
        sa.ForeignKeyConstraint(
            ["parent_ticket_id"], ["postal_tickets.id"],
            name="fk_postal_tickets_parent", ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    for name, columns in (
        ("ix_postal_tickets_type", ["type"]),
        ("ix_postal_tickets_postal_delivery_id", ["postal_delivery_id"]),
        ("ix_postal_tickets_order_id", ["order_id"]),
        ("ix_postal_tickets_external_order_no", ["external_order_no"]),
        ("ix_postal_tickets_year", ["year"]),
        ("ix_postal_tickets_status", ["status"]),
        ("ix_postal_tickets_parent_ticket_id", ["parent_ticket_id"]),
    ):
        op.create_index(name, "postal_tickets", columns, unique=False)

    op.create_table(
        "postal_ticket_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("ticket_id", sa.Integer(), nullable=False),
        sa.Column("source_ticket_id", sa.Integer(), nullable=True),
        sa.Column(
            "event_type",
            EVENT_TYPE,
            server_default="handling",
            nullable=False,
        ),
        sa.Column("handled_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("handled_by", sa.Integer(), nullable=True),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("follow_result", sa.Text(), nullable=True),
        sa.Column("result_status", sa.String(length=16), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["ticket_id"], ["postal_tickets.id"],
            name="fk_postal_ticket_events_ticket", ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["source_ticket_id"], ["postal_tickets.id"],
            name="fk_postal_ticket_events_source", ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["handled_by"], ["users.id"], name="fk_postal_ticket_events_user"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_ticket_id", name="uq_postal_ticket_events_source"),
    )
    op.create_index(
        "ix_postal_ticket_events_ticket_id",
        "postal_ticket_events",
        ["ticket_id"],
        unique=False,
    )
    op.create_index(
        "ix_postal_ticket_events_event_type",
        "postal_ticket_events",
        ["event_type"],
        unique=False,
    )


def _row_year(row, date_key: str):
    if row.get("year"):
        return row["year"]
    external = row.get("external_order_no")
    if external and "-" in external:
        head = external.split("-", 1)[0]
        if head.isdigit():
            return int(head)
    value = row.get(date_key)
    return value.year if value else None


def _copy_to_unified() -> None:
    bind = op.get_bind()
    metadata = sa.MetaData()
    complaints = sa.Table("postal_complaints", metadata, autoload_with=bind)
    addresses = sa.Table("postal_address_changes", metadata, autoload_with=bind)
    follows = sa.Table("postal_follow_ups", metadata, autoload_with=bind)
    old_events = sa.Table(
        "postal_complaint_handling_records", metadata, autoload_with=bind
    )
    tickets = sa.Table("postal_tickets", metadata, autoload_with=bind)
    events = sa.Table("postal_ticket_events", metadata, autoload_with=bind)

    complaint_rows = [dict(r) for r in bind.execute(sa.select(complaints)).mappings()]
    address_rows = [dict(r) for r in bind.execute(sa.select(addresses)).mappings()]
    follow_rows = [dict(r) for r in bind.execute(sa.select(follows)).mappings()]
    handling_rows = [dict(r) for r in bind.execute(sa.select(old_events)).mappings()]

    ticket_values = []
    complaint_candidates = {}
    next_id = 1
    for row in complaint_rows:
        next_id = max(next_id, row["id"] + 1)
        ticket_values.append({
            "id": row["id"],
            "type": "complaint",
            "postal_delivery_id": row.get("postal_delivery_id"),
            "order_id": row.get("order_id"),
            "external_order_no": row.get("external_order_no"),
            "year": _row_year(row, "complaint_date"),
            "complaint_date": row.get("complaint_date"),
            "missing_issues": row.get("missing_issues"),
            "handling": row.get("handling"),
            "routed_label": row.get("routed_label"),
            "routed_unit_id": row.get("routed_unit_id"),
            "follow_up": row.get("follow_up"),
            "handling_count": row.get("handling_count"),
            "status": row.get("status") or "open",
            "first_handler": row.get("first_handler"),
            "snap_name": row.get("snap_name"),
            "snap_phone": row.get("snap_phone"),
            "snap_address": row.get("snap_address"),
            "snap_postal_code": row.get("snap_postal_code"),
            "applied_to_order": False,
            "notes": row.get("notes"),
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at") or row.get("created_at"),
        })
        external = row.get("external_order_no")
        if external:
            complaint_candidates.setdefault(external, []).append(
                (row.get("complaint_date") or date.min, row["id"])
            )
    for candidates in complaint_candidates.values():
        candidates.sort()

    for row in address_rows:
        ticket_id = next_id
        next_id += 1
        row["_ticket_id"] = ticket_id
        ticket_values.append({
            "id": ticket_id,
            "type": "address",
            "postal_delivery_id": row.get("postal_delivery_id"),
            "order_id": row.get("order_id"),
            "external_order_no": row.get("external_order_no"),
            "year": _row_year(row, "change_date"),
            "change_date": row.get("change_date"),
            "old_name": row.get("old_name"),
            "old_phone": row.get("old_phone"),
            "old_address": row.get("old_address"),
            "old_copies": row.get("old_copies"),
            "new_name": row.get("new_name"),
            "new_phone": row.get("new_phone"),
            "new_address": row.get("new_address"),
            "new_copies": row.get("new_copies"),
            "original_start_month": row.get("original_start_month"),
            "effective_start_month": row.get("effective_start_month"),
            "handling": row.get("handling"),
            "routed_label": row.get("routed_label"),
            "applied_to_order": bool(row.get("applied_to_order")),
            "applied_by": row.get("applied_by"),
            "applied_at": row.get("applied_at"),
            "notes": row.get("notes"),
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at") or row.get("created_at"),
        })

    for row in follow_rows:
        ticket_id = next_id
        next_id += 1
        row["_ticket_id"] = ticket_id
        candidates = complaint_candidates.get(row.get("external_order_no"), [])
        parent_id = None
        if candidates:
            follow_date = row.get("follow_up_date") or date.max
            eligible = [candidate for candidate in candidates if candidate[0] <= follow_date]
            parent_id = (eligible[-1] if eligible else candidates[-1])[1]
        row["_parent_id"] = parent_id
        ticket_values.append({
            "id": ticket_id,
            "type": "follow",
            "postal_delivery_id": row.get("postal_delivery_id"),
            "order_id": row.get("order_id"),
            "external_order_no": row.get("external_order_no"),
            "year": _row_year(row, "follow_up_date"),
            "follow_up_date": row.get("follow_up_date"),
            "batch_label": row.get("batch_label"),
            "result": row.get("result"),
            "snap_name": row.get("snap_name"),
            "parent_ticket_id": parent_id,
            "applied_to_order": False,
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at") or row.get("created_at"),
        })

    if ticket_values:
        ticket_columns = [column.name for column in tickets.columns]
        bind.execute(
            sa.insert(tickets),
            [
                {column: value.get(column) for column in ticket_columns}
                for value in ticket_values
            ],
        )

    event_values = []
    next_event_id = 1
    for row in handling_rows:
        next_event_id = max(next_event_id, row["id"] + 1)
        event_values.append({
            "id": row["id"],
            "ticket_id": row["complaint_id"],
            "event_type": "handling",
            "handled_at": row.get("handled_at"),
            "handled_by": row.get("handled_by"),
            "action": row.get("action"),
            "follow_result": row.get("follow_result"),
            "result_status": row.get("result_status"),
            "created_at": row.get("created_at"),
        })
    for row in address_rows:
        if not row.get("applied_to_order"):
            continue
        event_values.append({
            "id": next_event_id,
            "ticket_id": row["_ticket_id"],
            "event_type": "address_applied",
            "handled_at": row.get("applied_at") or row.get("updated_at") or datetime.now(),
            "handled_by": row.get("applied_by"),
            "action": "应用新地址",
            "follow_result": "历史记录已应用",
            "created_at": row.get("applied_at") or row.get("created_at") or datetime.now(),
        })
        next_event_id += 1
    for row in follow_rows:
        if not row.get("_parent_id"):
            continue
        follow_date = row.get("follow_up_date")
        event_values.append({
            "id": next_event_id,
            "ticket_id": row["_parent_id"],
            "source_ticket_id": row["_ticket_id"],
            "event_type": "follow_up",
            "handled_at": (
                datetime.combine(follow_date, time.min)
                if follow_date else row.get("created_at") or datetime.now()
            ),
            "action": row.get("batch_label") or "回访",
            "follow_result": row.get("result"),
            "created_at": row.get("created_at") or datetime.now(),
        })
        next_event_id += 1
    if event_values:
        event_columns = [column.name for column in events.columns]
        bind.execute(
            sa.insert(events),
            [
                {column: value.get(column) for column in event_columns}
                for value in event_values
            ],
        )


def upgrade() -> None:
    _create_unified_tables()
    _copy_to_unified()
    op.drop_table("postal_complaint_handling_records")
    op.drop_table("postal_follow_ups")
    op.drop_table("postal_address_changes")
    op.drop_table("postal_complaints")


def _create_legacy_tables() -> None:
    op.create_table(
        "postal_complaints",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=True),
        sa.Column("external_order_no", sa.String(length=64), nullable=True),
        sa.Column("complaint_date", sa.Date(), nullable=True),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("missing_issues", sa.Text(), nullable=True),
        sa.Column("handling", sa.Text(), nullable=True),
        sa.Column("routed_label", sa.String(length=64), nullable=True),
        sa.Column("routed_unit_id", sa.Integer(), nullable=True),
        sa.Column("follow_up", sa.Text(), nullable=True),
        sa.Column("handling_count", sa.Integer(), nullable=True),
        sa.Column("status", COMPLAINT_STATUS, server_default="open", nullable=False),
        sa.Column("first_handler", sa.String(length=64), nullable=True),
        sa.Column("snap_name", sa.String(length=128), nullable=True),
        sa.Column("snap_phone", sa.String(length=64), nullable=True),
        sa.Column("snap_address", sa.Text(), nullable=True),
        sa.Column("snap_postal_code", sa.String(length=20), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("postal_delivery_id", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], name="fk_postal_complaints_order", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["routed_unit_id"], ["partners.id"], name="fk_postal_complaints_routed_unit", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["postal_delivery_id"], ["postal_delivery.id"], name="fk_postal_complaints_postal_delivery", ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    for name, columns in (
        ("ix_postal_complaints_order_id", ["order_id"]),
        ("ix_postal_complaints_external_order_no", ["external_order_no"]),
        ("ix_postal_complaints_status", ["status"]),
        ("ix_postal_complaints_postal_delivery_id", ["postal_delivery_id"]),
    ):
        op.create_index(name, "postal_complaints", columns, unique=False)

    op.create_table(
        "postal_address_changes",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=True),
        sa.Column("external_order_no", sa.String(length=64), nullable=True),
        sa.Column("change_date", sa.Date(), nullable=True),
        sa.Column("old_name", sa.String(length=128), nullable=True),
        sa.Column("old_phone", sa.String(length=64), nullable=True),
        sa.Column("old_address", sa.Text(), nullable=True),
        sa.Column("old_copies", sa.Integer(), nullable=True),
        sa.Column("new_name", sa.String(length=128), nullable=True),
        sa.Column("new_phone", sa.String(length=64), nullable=True),
        sa.Column("new_address", sa.Text(), nullable=True),
        sa.Column("new_copies", sa.Integer(), nullable=True),
        sa.Column("original_start_month", sa.String(length=16), nullable=True),
        sa.Column("effective_start_month", sa.String(length=16), nullable=True),
        sa.Column("handling", sa.String(length=128), nullable=True),
        sa.Column("routed_label", sa.String(length=64), nullable=True),
        sa.Column("applied_to_order", sa.Boolean(), server_default=sa.text("0"), nullable=False),
        sa.Column("applied_by", sa.Integer(), nullable=True),
        sa.Column("applied_at", sa.DateTime(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("postal_delivery_id", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], name="fk_postal_addr_order", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["applied_by"], ["users.id"], name="fk_postal_addr_applied_by"),
        sa.ForeignKeyConstraint(["postal_delivery_id"], ["postal_delivery.id"], name="fk_postal_address_changes_postal_delivery", ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    for name, columns in (
        ("ix_postal_addr_order_id", ["order_id"]),
        ("ix_postal_addr_external_order_no", ["external_order_no"]),
        ("ix_postal_address_changes_postal_delivery_id", ["postal_delivery_id"]),
    ):
        op.create_index(name, "postal_address_changes", columns, unique=False)

    op.create_table(
        "postal_follow_ups",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=True),
        sa.Column("external_order_no", sa.String(length=64), nullable=True),
        sa.Column("follow_up_date", sa.Date(), nullable=True),
        sa.Column("batch_label", sa.String(length=32), nullable=True),
        sa.Column("result", sa.Text(), nullable=True),
        sa.Column("snap_name", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("postal_delivery_id", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], name="fk_postal_follow_order", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["postal_delivery_id"], ["postal_delivery.id"], name="fk_postal_follow_ups_postal_delivery", ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    for name, columns in (
        ("ix_postal_follow_order_id", ["order_id"]),
        ("ix_postal_follow_external_order_no", ["external_order_no"]),
        ("ix_postal_follow_ups_postal_delivery_id", ["postal_delivery_id"]),
    ):
        op.create_index(name, "postal_follow_ups", columns, unique=False)

    op.create_table(
        "postal_complaint_handling_records",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("complaint_id", sa.Integer(), nullable=False),
        sa.Column("handled_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("handled_by", sa.Integer(), nullable=True),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("follow_result", sa.Text(), nullable=True),
        sa.Column("result_status", sa.String(length=16), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["complaint_id"], ["postal_complaints.id"], name="fk_pchr_complaint", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["handled_by"], ["users.id"], name="fk_pchr_handled_by"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_postal_complaint_handling_records_complaint_id", "postal_complaint_handling_records", ["complaint_id"])


def _copy_to_legacy() -> None:
    bind = op.get_bind()
    metadata = sa.MetaData()
    tickets = sa.Table("postal_tickets", metadata, autoload_with=bind)
    events = sa.Table("postal_ticket_events", metadata, autoload_with=bind)
    complaints = sa.Table("postal_complaints", metadata, autoload_with=bind)
    addresses = sa.Table("postal_address_changes", metadata, autoload_with=bind)
    follows = sa.Table("postal_follow_ups", metadata, autoload_with=bind)
    old_events = sa.Table("postal_complaint_handling_records", metadata, autoload_with=bind)

    rows = [dict(r) for r in bind.execute(sa.select(tickets)).mappings()]
    complaint_values = []
    address_values = []
    follow_values = []
    for row in rows:
        if row["type"] == "complaint":
            complaint_values.append({k: row.get(k) for k in (
                "id", "order_id", "external_order_no", "complaint_date", "year",
                "missing_issues", "handling", "routed_label", "routed_unit_id",
                "follow_up", "handling_count", "status", "first_handler", "snap_name",
                "snap_phone", "snap_address", "snap_postal_code", "notes", "created_at",
                "postal_delivery_id", "updated_at",
            )})
        elif row["type"] == "address":
            address_values.append({k: row.get(k) for k in (
                "id", "order_id", "external_order_no", "change_date", "old_name",
                "old_phone", "old_address", "old_copies", "new_name", "new_phone",
                "new_address", "new_copies", "original_start_month",
                "effective_start_month", "handling", "routed_label", "applied_to_order",
                "applied_by", "applied_at", "notes", "created_at", "postal_delivery_id",
                "updated_at",
            )})
        else:
            follow_values.append({k: row.get(k) for k in (
                "id", "order_id", "external_order_no", "follow_up_date", "batch_label",
                "result", "snap_name", "created_at", "postal_delivery_id", "updated_at",
            )})
    if complaint_values:
        bind.execute(sa.insert(complaints), complaint_values)
    if address_values:
        bind.execute(sa.insert(addresses), address_values)
    if follow_values:
        bind.execute(sa.insert(follows), follow_values)

    handling_values = []
    for row in bind.execute(
        sa.select(events).where(events.c.event_type == "handling")
    ).mappings():
        handling_values.append({
            "id": row["id"],
            "complaint_id": row["ticket_id"],
            "handled_at": row["handled_at"],
            "handled_by": row["handled_by"],
            "action": row["action"],
            "follow_result": row["follow_result"],
            "result_status": row["result_status"],
            "created_at": row["created_at"],
        })
    if handling_values:
        bind.execute(sa.insert(old_events), handling_values)


def downgrade() -> None:
    _create_legacy_tables()
    _copy_to_legacy()
    # 新表自身的索引和外键随表删除，不单独 drop_index。
    op.drop_table("postal_ticket_events")
    op.drop_table("postal_tickets")
