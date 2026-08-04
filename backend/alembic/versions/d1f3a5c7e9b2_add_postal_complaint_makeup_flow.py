"""add postal complaint makeup flow

Revision ID: d1f3a5c7e9b2
Revises: c0e2f4a6b8d1
Create Date: 2026-08-04
"""

from alembic import op
import sqlalchemy as sa


revision = "d1f3a5c7e9b2"
down_revision = "c0e2f4a6b8d1"
branch_labels = None
depends_on = None


def _add_enum_value(type_name: str, value: str) -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(sa.text(f"ALTER TYPE {type_name} ADD VALUE IF NOT EXISTS '{value}'"))


def upgrade() -> None:
    _add_enum_value("shippingdetailsourcetype", "complaint_makeup")
    for value in ("makeup_created", "makeup_shipped", "makeup_completed", "makeup_cancelled"):
        _add_enum_value("postalticketeventtype", value)

    if op.get_bind().dialect.name == "mysql":
        op.alter_column(
            "shipping_details",
            "source_type",
            existing_type=sa.Enum("manual", "order_generated", "historical_import"),
            type_=sa.Enum("manual", "order_generated", "historical_import", "complaint_makeup"),
            existing_nullable=False,
            existing_server_default="manual",
        )
        op.alter_column(
            "postal_ticket_events",
            "event_type",
            existing_type=sa.Enum("handling", "follow_up", "address_applied"),
            type_=sa.Enum(
                "handling", "follow_up", "address_applied", "makeup_created",
                "makeup_shipped", "makeup_completed", "makeup_cancelled",
            ),
            existing_nullable=False,
            existing_server_default="handling",
        )

    makeup_status = sa.Enum(
        "ready", "shipped", "completed", "cancelled",
        name="postalcomplaintmakeupstatus",
    )
    makeup_status.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "postal_complaint_makeup_tasks",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("complaint_id", sa.Integer(), nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=True),
        sa.Column("postal_delivery_id", sa.Integer(), nullable=True),
        sa.Column("recipient_name", sa.String(length=128), nullable=False),
        sa.Column("recipient_phone", sa.String(length=64), nullable=True),
        sa.Column("recipient_address", sa.Text(), nullable=False),
        sa.Column("status", makeup_status, nullable=False, server_default="ready"),
        sa.Column("tracking_no", sa.String(length=64), nullable=True),
        sa.Column("shipped_at", sa.DateTime(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["complaint_id"], ["postal_tickets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["postal_delivery_id"], ["postal_delivery.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_makeup_task_complaint", "postal_complaint_makeup_tasks", ["complaint_id"])
    op.create_index("ix_makeup_task_order", "postal_complaint_makeup_tasks", ["order_id"])
    op.create_index("ix_makeup_task_delivery", "postal_complaint_makeup_tasks", ["postal_delivery_id"])
    op.create_index("ix_makeup_task_status", "postal_complaint_makeup_tasks", ["status"])

    op.create_table(
        "postal_complaint_makeup_items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("task_id", sa.Integer(), nullable=False),
        sa.Column("issue_number", sa.Integer(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["task_id"], ["postal_complaint_makeup_tasks.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("task_id", "issue_number", name="uq_makeup_task_issue"),
    )
    op.create_index("ix_makeup_item_task", "postal_complaint_makeup_items", ["task_id"])
    op.create_index("ix_makeup_item_issue", "postal_complaint_makeup_items", ["issue_number"])

    op.add_column("shipping_details", sa.Column("complaint_makeup_item_id", sa.Integer(), nullable=True))
    op.create_index("ix_shipping_details_makeup_item", "shipping_details", ["complaint_makeup_item_id"], unique=True)
    op.create_foreign_key(
        "fk_shipping_details_makeup_item",
        "shipping_details",
        "postal_complaint_makeup_items",
        ["complaint_makeup_item_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_shipping_details_makeup_item", "shipping_details", type_="foreignkey")
    op.drop_index("ix_shipping_details_makeup_item", table_name="shipping_details")
    op.drop_column("shipping_details", "complaint_makeup_item_id")
    op.drop_index("ix_makeup_item_issue", table_name="postal_complaint_makeup_items")
    op.drop_index("ix_makeup_item_task", table_name="postal_complaint_makeup_items")
    op.drop_table("postal_complaint_makeup_items")
    op.drop_index("ix_makeup_task_status", table_name="postal_complaint_makeup_tasks")
    op.drop_index("ix_makeup_task_delivery", table_name="postal_complaint_makeup_tasks")
    op.drop_index("ix_makeup_task_order", table_name="postal_complaint_makeup_tasks")
    op.drop_index("ix_makeup_task_complaint", table_name="postal_complaint_makeup_tasks")
    op.drop_table("postal_complaint_makeup_tasks")
    sa.Enum(name="postalcomplaintmakeupstatus").drop(op.get_bind(), checkfirst=True)
    if op.get_bind().dialect.name == "mysql":
        op.execute(sa.text("DELETE FROM shipping_details WHERE source_type = 'complaint_makeup'"))
        op.execute(sa.text("DELETE FROM postal_ticket_events WHERE event_type LIKE 'makeup_%'"))
        op.alter_column(
            "shipping_details",
            "source_type",
            existing_type=sa.Enum("manual", "order_generated", "historical_import", "complaint_makeup"),
            type_=sa.Enum("manual", "order_generated", "historical_import"),
            existing_nullable=False,
            existing_server_default="manual",
        )
        op.alter_column(
            "postal_ticket_events",
            "event_type",
            existing_type=sa.Enum(
                "handling", "follow_up", "address_applied", "makeup_created",
                "makeup_shipped", "makeup_completed", "makeup_cancelled",
            ),
            type_=sa.Enum("handling", "follow_up", "address_applied"),
            existing_nullable=False,
            existing_server_default="handling",
        )
