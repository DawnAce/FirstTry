"""Product resolver (Phase 3a).

Turns one e-commerce product-line string (already split out of the multi-line
产品名称 field by the import parser) into the order item attributes it maps to,
using the product catalog (商品库).

Pure functions over a preloaded list of ``Product`` rows so they are cheap to
call per line and easy to unit-test without a DB session.

Scope boundary:
* HERE: catalog match (code/alias/normalized), attribute copy, bundle fan-out
  (中国经营报 fixed ¥240 + 商学院 remainder), price = ACTUAL paid (not list_price).
* NOT here (the import service, Phase 3b): splitting the multi-line 产品名称,
  dropping X0/运费 lines, recipient/address parsing, dedup, status filter, and
  **coverage dates** — those depend on the operator's per-batch start settings,
  so each resolved item carries its ``coverage_rule`` and leaves coverage blank.
"""

from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Optional

from app.models.order_item import DeliveryMethod, Publication, SubscriptionTerm
from app.models.product import CoverageRule, Product
from app.schemas.order import OrderItemIn


def _norm(value: Optional[str]) -> str:
    """Whitespace-insensitive form for matching."""
    return "".join((value or "").split())


def _money(value) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


@dataclass
class ResolvedItem:
    """One order item the resolver produced (coverage dates left for 3b to fill)."""

    item: OrderItemIn
    coverage_rule: CoverageRule


@dataclass
class ProductResolution:
    matched: bool
    product_code: Optional[str] = None
    items: List[ResolvedItem] = field(default_factory=list)
    reason: Optional[str] = None  # why it did not match (for the 待确认 queue)
    warnings: List[str] = field(default_factory=list)


def match_product(products: List[Product], raw_name: str) -> Optional[Product]:
    """Find the catalog product for a raw product-line name.

    ``products`` is the candidate set (the caller passes the active rows).
    Priority: exact display_name > exact alias > alias contained in the name >
    display_name overlap (either direction, for campaign-suffix variants).

    The final overlap tier deliberately **skips bundles**: a bundle is high-stakes
    (it fans out into N priced items and splits the paid amount), so it resolves
    only by exact display_name or explicit alias. Otherwise a standalone line like
    ``《商学院》全年订阅`` would substring-match the bundle name
    ``《中国经营报》和《商学院》全年订阅（8折优惠）`` that literally contains it and get
    silently mis-split into 中国经营报 + 商学院.
    """
    target = _norm(raw_name)
    if not target:
        return None
    for p in products:
        if _norm(p.display_name) == target:
            return p
    for p in products:
        for alias in (p.aliases or []):
            if _norm(alias) == target:
                return p
    for p in products:
        for alias in (p.aliases or []):
            if alias and _norm(alias) in target:
                return p
    for p in products:
        if p.is_bundle:
            continue
        name = _norm(p.display_name)
        if name and (name in target or target in name):
            return p
    return None


def _make_item(
    *,
    publication: Publication,
    publication_format,
    fulfillment_type,
    billing_type,
    subscription_term,
    delivery_method,
    total_quantity: int,
    share: Decimal,
) -> OrderItemIn:
    qty = max(1, int(total_quantity))
    return OrderItemIn(
        publication=publication,
        publication_format=publication_format,
        fulfillment_type=fulfillment_type,
        billing_type=billing_type,
        subscription_term=subscription_term,
        delivery_method=delivery_method,
        total_quantity=qty,
        unit_price=_money(Decimal(str(share)) / Decimal(qty)),
        subtotal=_money(share),
        targets=[],  # recipient is attached by the import service from the 地址 field
    )


def resolve_product(
    products: List[Product],
    raw_name: str,
    quantity,
    paid_amount,
) -> ProductResolution:
    """Resolve one product-line into 1 (normal) or N (bundle) order items.

    ``paid_amount`` is the amount attributable to THIS product line (the import
    service already removed shipping-surcharge lines). ``unit_price`` is the
    actual paid amount per copy — not the catalog ``list_price`` — so promo
    discounts are preserved.
    """
    product = match_product(products, raw_name)
    if product is None:
        return ProductResolution(matched=False, reason=f"商品库无匹配：{raw_name!r}")

    paid = Decimal(str(paid_amount))
    qty = max(1, int(quantity))
    warnings: List[str] = []

    if product.is_bundle:
        comps = product.components or []
        fixed_total = sum(
            (
                Decimal(str(c["fixed_price"]))
                for c in comps
                if c.get("fixed_price") is not None
            ),
            Decimal("0"),
        )
        remainder_amount = paid - fixed_total
        if remainder_amount < 0:
            warnings.append(
                f"套餐实付 ¥{paid} 少于固定项合计 ¥{fixed_total}，余额为负，请核对"
            )
        items: List[ResolvedItem] = []
        for c in comps:
            share = remainder_amount if c.get("remainder") else Decimal(str(c["fixed_price"]))
            rule = (
                CoverageRule(c["coverage_rule"])
                if c.get("coverage_rule")
                else product.coverage_rule
            )
            term = (
                SubscriptionTerm(c["subscription_term"])
                if c.get("subscription_term")
                else product.subscription_term
            )
            # 每组件可设自己的投递（如中国经营报=邮局、商学院=中通）；未设则回落套餐顶层。
            delivery = (
                DeliveryMethod(c["delivery_method"])
                if c.get("delivery_method")
                else product.delivery_method
            )
            items.append(
                ResolvedItem(
                    item=_make_item(
                        publication=Publication(c["publication"]),
                        publication_format=product.publication_format,
                        fulfillment_type=product.fulfillment_type,
                        billing_type=product.billing_type,
                        subscription_term=term,
                        delivery_method=delivery,
                        total_quantity=qty,
                        share=share,
                    ),
                    coverage_rule=rule,
                )
            )
        return ProductResolution(
            matched=True, product_code=product.code, items=items, warnings=warnings
        )

    # Non-bundle: a single item carrying the whole paid amount.
    item = _make_item(
        publication=product.publication,
        publication_format=product.publication_format,
        fulfillment_type=product.fulfillment_type,
        billing_type=product.billing_type,
        subscription_term=product.subscription_term,
        delivery_method=product.delivery_method,
        total_quantity=qty,
        share=paid,
    )
    return ProductResolution(
        matched=True,
        product_code=product.code,
        items=[ResolvedItem(item=item, coverage_rule=product.coverage_rule)],
        warnings=warnings,
    )
