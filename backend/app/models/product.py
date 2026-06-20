import enum

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Enum as SAEnum,
    Index,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
)
from sqlalchemy.sql import func

from app.database import Base
# Reuse the order-item enums verbatim so a product row maps 1:1 onto the
# OrderItem snapshot fields — the resolver is then a straight field copy.
from app.models.order_item import (
    BillingType,
    DeliveryMethod,
    FulfillmentType,
    Publication,
    PublicationFormat,
    SubscriptionTerm,
)


class CoverageRule(str, enum.Enum):
    """How to derive an order item's coverage window from a product at import.

    * ``term_from_month`` — subscription: derive coverage from
      ``subscription_term`` + the order's month (reuses build_pricing_preview /
      the publication schedule). The default for 全年/半年订阅.
    * ``latest_issue``    — single issue: the latest / next publishable issue.
    * ``explicit``        — use the fixed ``coverage_start_date`` /
      ``coverage_end_date`` stored on the product (e.g. a fixed campaign run).
    * ``custom``          — coverage is supplied per-order / left for manual
      resolution (the importer flags it for the human queue).
    """

    term_from_month = "term_from_month"
    latest_issue = "latest_issue"
    explicit = "explicit"
    custom = "custom"


class Product(Base):
    """商品库 — the source of truth that maps an e-commerce product string to
    the fulfillment attributes an order item needs.

    This is a data-driven mapping layer, NOT a storefront catalog: a new promo
    SKU is a row insert, not a parser code change. Orders keep snapshotting
    their item attributes (``order_items``), so this catalog governs only how
    *future* imports resolve — it never mutates historical orders.

    Pricing note: the importer sets ``order_item.unit_price`` to the ACTUAL paid
    price, not ``list_price``. ``list_price`` is a reference only (variance
    flagging). No price-list / effective-dating / inventory in V1 — line-level
    price snapshots already preserve price history.
    """

    __tablename__ = "products"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # Stable SKU used for code-first matching. Operator-assigned.
    code = Column(String(64), nullable=False, unique=True)
    # The raw / canonical e-commerce product string, e.g.
    # "《中国经营报》全年订阅-618促销活动".
    display_name = Column(String(255), nullable=False)
    # Alternate match strings (campaign-suffix variants across platforms).
    # A flat JSON list of strings; folded here instead of a child table while
    # the catalog is small.
    aliases = Column(JSON, nullable=True)

    # --- maps 1:1 onto OrderItem snapshot fields ---
    # NULL for bundles (see ``components``); the resolver fans a bundle out.
    publication = Column(SAEnum(Publication), nullable=True)
    publication_format = Column(
        SAEnum(PublicationFormat), nullable=False, default=PublicationFormat.paper
    )
    fulfillment_type = Column(SAEnum(FulfillmentType), nullable=False)
    subscription_term = Column(SAEnum(SubscriptionTerm), nullable=True)
    delivery_method = Column(SAEnum(DeliveryMethod), nullable=True)
    billing_type = Column(SAEnum(BillingType), nullable=False, default=BillingType.paid)

    coverage_rule = Column(
        SAEnum(CoverageRule), nullable=False, default=CoverageRule.term_from_month
    )
    # Only used when coverage_rule == explicit.
    coverage_start_date = Column(Date, nullable=True)
    coverage_end_date = Column(Date, nullable=True)

    # Reference list price (variance flag only — NOT what the customer is
    # charged; the order item snapshots the actual paid price).
    list_price = Column(Numeric(10, 2), nullable=False, default=0)

    # Bundle support without a child table: when set, the resolver fans this
    # product into N order items and splits the ACTUAL paid price by the rule
    # "fixed components take their fixed_price, one 'remainder' component
    # absorbs the rest" (e.g. CBJ fixed ¥240, 商学院 = paid - 240).
    # Shape: [{"publication": "cbj", "subscription_term": "one_year",
    #          "coverage_rule": "term_from_month", "fixed_price": 240},
    #         {"publication": "business_school", "subscription_term": "one_year",
    #          "coverage_rule": "term_from_month", "remainder": true}].
    # The resolver flags the row for review if the remainder is negative.
    is_bundle = Column(Boolean, nullable=False, default=False)
    components = Column(JSON, nullable=True)

    active = Column(Boolean, nullable=False, default=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_products_active", "active"),
    )
