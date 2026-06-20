"""add products (商品库) catalog table

Phase 2.5: a data-driven product catalog that maps an e-commerce product string
to the fulfillment attributes an order item needs. Purely additive — no change to
orders / order_items / allocations / targets. The catalog governs only how future
imports resolve; orders keep their own snapshot, so history is never mutated.

Revision ID: d7f9b1c3e5a8
Revises: c5e7a9b2d4f6
Create Date: 2026-06-20
"""

from alembic import op
import sqlalchemy as sa


revision = "d7f9b1c3e5a8"
down_revision = "c5e7a9b2d4f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "products",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("aliases", sa.JSON(), nullable=True),
        sa.Column(
            "publication",
            sa.Enum("cbj", "business_school", "other", name="publication"),
            nullable=True,
        ),
        sa.Column(
            "publication_format",
            sa.Enum("paper", "digital", name="publicationformat"),
            server_default="paper",
            nullable=False,
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
            "subscription_term",
            sa.Enum("half_year", "one_year", "custom", name="subscriptionterm"),
            nullable=True,
        ),
        sa.Column(
            "delivery_method",
            sa.Enum("post_office", "zto_mf", name="deliverymethod"),
            nullable=True,
        ),
        sa.Column(
            "billing_type",
            sa.Enum("paid", "free_gift", "bundle_gift", name="billingtype"),
            server_default="paid",
            nullable=False,
        ),
        sa.Column(
            "coverage_rule",
            sa.Enum(
                "term_from_month",
                "latest_issue",
                "explicit",
                "custom",
                name="coveragerule",
            ),
            server_default="term_from_month",
            nullable=False,
        ),
        sa.Column("coverage_start_date", sa.Date(), nullable=True),
        sa.Column("coverage_end_date", sa.Date(), nullable=True),
        sa.Column(
            "list_price", sa.Numeric(precision=10, scale=2), server_default="0", nullable=False
        ),
        sa.Column("is_bundle", sa.Boolean(), server_default=sa.text("0"), nullable=False),
        sa.Column("components", sa.JSON(), nullable=True),
        sa.Column("active", sa.Boolean(), server_default=sa.text("1"), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code", name="uq_products_code"),
    )
    op.create_index("ix_products_active", "products", ["active"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_products_active", table_name="products")
    op.drop_table("products")
