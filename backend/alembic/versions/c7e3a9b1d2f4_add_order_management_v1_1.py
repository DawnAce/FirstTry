"""add order management v1.1 tables

Revision ID: c7e3a9b1d2f4
Revises: b2c3d4e5f6a7
Create Date: 2026-05-28 15:00:00.000000

Creates 5 new tables for the V1.1 order management module:
  - orders
  - order_items
  - fulfillment_allocations
  - fulfillment_targets
  - order_events

And extends shipping_details with 5 nullable / defaulted columns that
link a shipping row back to its source order. Existing rows are
preserved by giving the two non-null enum columns server_defaults
('manual', 'synced'), so legacy hand-entered ZTO rows remain valid.

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c7e3a9b1d2f4"
down_revision: Union[str, None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. orders
    # ------------------------------------------------------------------
    op.create_table(
        "orders",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("order_code", sa.String(length=64), nullable=True),
        sa.Column("external_order_no", sa.String(length=128), nullable=True),
        sa.Column("order_date", sa.Date(), nullable=False),
        sa.Column(
            "source_type",
            sa.Enum(
                "ecommerce",
                "corporate_transfer",
                "vip_gift",
                "manual",
                "mail_annual",
                name="ordersourcetype",
            ),
            nullable=False,
        ),
        sa.Column("source_platform", sa.String(length=64), nullable=True),
        sa.Column("source_store", sa.String(length=128), nullable=True),
        sa.Column("payer_name", sa.String(length=128), nullable=False),
        sa.Column("payer_contact", sa.String(length=64), nullable=True),
        sa.Column(
            "payment_method",
            sa.Enum(
                "wechat",
                "alipay",
                "bank_card",
                "corporate_transfer",
                "cash",
                "offset",
                "other",
                name="orderpaymentmethod",
            ),
            nullable=True,
        ),
        sa.Column("payment_collector", sa.String(length=64), nullable=True),
        sa.Column("total_amount", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("paid_amount", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("invoice_required", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("invoice_title", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Enum("draft", "pending_confirmation", "active", "void", name="orderstatus"),
            nullable=False,
            server_default="draft",
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("import_batch_id", sa.Integer(), nullable=True),
        sa.Column("import_row_no", sa.Integer(), nullable=True),
        sa.Column("import_source_sheet", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], name="fk_orders_created_by"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("order_code", name="uq_orders_order_code"),
    )
    op.create_index(op.f("ix_orders_order_code"), "orders", ["order_code"], unique=False)
    op.create_index(op.f("ix_orders_external_order_no"), "orders", ["external_order_no"], unique=False)
    op.create_index(op.f("ix_orders_status"), "orders", ["status"], unique=False)
    op.create_index("ix_orders_source_status_date", "orders", ["source_type", "status", "order_date"], unique=False)
    op.create_index("ix_orders_payer", "orders", ["payer_name"], unique=False)

    # ------------------------------------------------------------------
    # 2. order_items
    # ------------------------------------------------------------------
    op.create_table(
        "order_items",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=False),
        sa.Column(
            "publication",
            sa.Enum("cbj", "business_school", "other", name="publication"),
            nullable=False,
            server_default="cbj",
        ),
        sa.Column(
            "publication_format",
            sa.Enum("paper", "digital", name="publicationformat"),
            nullable=False,
            server_default="paper",
        ),
        sa.Column(
            "fulfillment_type",
            sa.Enum(
                "subscription",
                "single_issue",
                "gift",
                "makeup",
                "extension",
                "replacement",
                name="fulfillmenttype",
            ),
            nullable=False,
        ),
        sa.Column(
            "billing_type",
            sa.Enum("paid", "free_gift", "bundle_gift", name="billingtype"),
            nullable=False,
            server_default="paid",
        ),
        sa.Column("coverage_start_date", sa.Date(), nullable=True),
        sa.Column("coverage_end_date", sa.Date(), nullable=True),
        sa.Column("issue_number", sa.Integer(), nullable=True),
        sa.Column("total_quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("unit_price", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("subtotal", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("expected_issues_at_creation", sa.Integer(), nullable=True),
        sa.Column(
            "status",
            sa.Enum("active", "cancelled", name="orderitemstatus"),
            nullable=False,
            server_default="active",
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["order_id"], ["orders.id"], name="fk_order_items_order_id", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_order_items_order_id"), "order_items", ["order_id"], unique=False)
    op.create_index(
        "ix_order_items_publication_type_status",
        "order_items",
        ["publication", "fulfillment_type", "status"],
        unique=False,
    )
    op.create_index(
        "ix_order_items_coverage",
        "order_items",
        ["coverage_start_date", "coverage_end_date"],
        unique=False,
    )

    # ------------------------------------------------------------------
    # 3. fulfillment_allocations
    # ------------------------------------------------------------------
    op.create_table(
        "fulfillment_allocations",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("order_item_id", sa.Integer(), nullable=False),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("effective_from_issue", sa.Integer(), nullable=True),
        sa.Column("effective_until_issue", sa.Integer(), nullable=True),
        sa.Column("change_reason", sa.String(length=255), nullable=True),
        sa.Column("operator_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["order_item_id"],
            ["order_items.id"],
            name="fk_fa_order_item_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["operator_id"], ["users.id"], name="fk_fa_operator_id"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("order_item_id", "version_no", name="uq_allocation_item_version"),
    )
    op.create_index(
        op.f("ix_fulfillment_allocations_order_item_id"),
        "fulfillment_allocations",
        ["order_item_id"],
        unique=False,
    )

    # ------------------------------------------------------------------
    # 4. fulfillment_targets
    # ------------------------------------------------------------------
    op.create_table(
        "fulfillment_targets",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("order_item_id", sa.Integer(), nullable=False),
        sa.Column("allocation_id", sa.Integer(), nullable=False),
        sa.Column("recipient_name", sa.String(length=128), nullable=False),
        sa.Column("recipient_phone", sa.String(length=64), nullable=True),
        sa.Column("recipient_address", sa.Text(), nullable=False),
        sa.Column("recipient_postal_code", sa.String(length=20), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "shipping_channel",
            sa.Enum(
                "zto_outsource", "post_office", "self_sf", "other", name="shippingchannel"
            ),
            nullable=False,
            server_default="zto_outsource",
        ),
        sa.Column("effective_from_issue", sa.Integer(), nullable=True),
        sa.Column("effective_until_issue", sa.Integer(), nullable=True),
        sa.Column(
            "status",
            sa.Enum("active", "suspended", "replaced", name="targetstatus"),
            nullable=False,
            server_default="active",
        ),
        sa.Column("replaced_by_target_id", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["order_item_id"],
            ["order_items.id"],
            name="fk_ft_order_item_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["allocation_id"],
            ["fulfillment_allocations.id"],
            name="fk_ft_allocation_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["replaced_by_target_id"],
            ["fulfillment_targets.id"],
            name="fk_ft_replaced_by_target_id",
            use_alter=True,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_fulfillment_targets_order_item_id"),
        "fulfillment_targets",
        ["order_item_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_fulfillment_targets_allocation_id"),
        "fulfillment_targets",
        ["allocation_id"],
        unique=False,
    )
    op.create_index(
        "ix_targets_eff_status",
        "fulfillment_targets",
        ["effective_from_issue", "effective_until_issue", "status"],
        unique=False,
    )

    # ------------------------------------------------------------------
    # 5. order_events
    # ------------------------------------------------------------------
    op.create_table(
        "order_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=False),
        sa.Column(
            "event_type",
            sa.Enum(
                "created",
                "imported",
                "confirmed",
                "modified",
                "split",
                "voided",
                "allocation_updated",
                "target_added",
                "target_replaced",
                "target_suspended",
                "synced_to_shipping",
                "shipping_sync_conflict",
                name="ordereventtype",
            ),
            nullable=False,
        ),
        sa.Column("payload_json", sa.JSON(), nullable=True),
        sa.Column("operator_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["order_id"],
            ["orders.id"],
            name="fk_order_events_order_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["operator_id"], ["users.id"], name="fk_order_events_operator_id"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_order_events_order_id"), "order_events", ["order_id"], unique=False
    )
    op.create_index(
        op.f("ix_order_events_event_type"), "order_events", ["event_type"], unique=False
    )
    op.create_index(
        op.f("ix_order_events_created_at"), "order_events", ["created_at"], unique=False
    )

    # ------------------------------------------------------------------
    # 6. Extend shipping_details (V1.1 order linkage)
    #    All three FK columns are nullable so existing manual rows stay
    #    untouched; the two enum columns get server_defaults so the
    #    NOT NULL constraint is satisfied for existing rows.
    # ------------------------------------------------------------------
    op.add_column("shipping_details", sa.Column("order_id", sa.Integer(), nullable=True))
    op.add_column("shipping_details", sa.Column("order_item_id", sa.Integer(), nullable=True))
    op.add_column(
        "shipping_details", sa.Column("fulfillment_target_id", sa.Integer(), nullable=True)
    )
    op.add_column(
        "shipping_details",
        sa.Column(
            "source_type",
            sa.Enum(
                "manual",
                "order_generated",
                "historical_import",
                name="shippingdetailsourcetype",
            ),
            nullable=False,
            server_default="manual",
        ),
    )
    op.add_column(
        "shipping_details",
        sa.Column(
            "sync_status",
            sa.Enum(
                "synced",
                "manually_modified",
                "orphaned",
                name="shippingdetailsyncstatus",
            ),
            nullable=False,
            server_default="synced",
        ),
    )
    op.create_foreign_key(
        "fk_shipping_details_order_id",
        "shipping_details",
        "orders",
        ["order_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_shipping_details_order_item_id",
        "shipping_details",
        "order_items",
        ["order_item_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_shipping_details_fulfillment_target_id",
        "shipping_details",
        "fulfillment_targets",
        ["fulfillment_target_id"],
        ["id"],
    )
    op.create_index(
        op.f("ix_shipping_details_order_id"),
        "shipping_details",
        ["order_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_shipping_details_source_type"),
        "shipping_details",
        ["source_type"],
        unique=False,
    )


def downgrade() -> None:
    # Reverse order of upgrade.
    # ------------------------------------------------------------------
    # 6'. Roll back shipping_details extensions
    #     MUST drop FK constraints BEFORE the indexes they depend on,
    #     because MySQL refuses to drop an index still referenced by a
    #     foreign key.
    # ------------------------------------------------------------------
    op.drop_constraint(
        "fk_shipping_details_fulfillment_target_id",
        "shipping_details",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_shipping_details_order_item_id", "shipping_details", type_="foreignkey"
    )
    op.drop_constraint(
        "fk_shipping_details_order_id", "shipping_details", type_="foreignkey"
    )
    op.drop_index(op.f("ix_shipping_details_source_type"), table_name="shipping_details")
    op.drop_index(op.f("ix_shipping_details_order_id"), table_name="shipping_details")
    op.drop_column("shipping_details", "sync_status")
    op.drop_column("shipping_details", "source_type")
    op.drop_column("shipping_details", "fulfillment_target_id")
    op.drop_column("shipping_details", "order_item_id")
    op.drop_column("shipping_details", "order_id")

    # ------------------------------------------------------------------
    # 5'. order_events
    #     drop_table cascades to indexes and foreign keys, so no need
    #     to drop_index first (and on MySQL it would actually fail
    #     because the order_id index is still referenced by the FK).
    # ------------------------------------------------------------------
    op.drop_table("order_events")

    # ------------------------------------------------------------------
    # 4'. fulfillment_targets (must drop before allocations & order_items)
    # ------------------------------------------------------------------
    op.drop_table("fulfillment_targets")

    # ------------------------------------------------------------------
    # 3'. fulfillment_allocations
    # ------------------------------------------------------------------
    op.drop_table("fulfillment_allocations")

    # ------------------------------------------------------------------
    # 2'. order_items
    # ------------------------------------------------------------------
    op.drop_table("order_items")

    # ------------------------------------------------------------------
    # 1'. orders
    # ------------------------------------------------------------------
    op.drop_table("orders")
