"""Tests for product_resolver_service (Phase 3a).

Pure functions over a list of Product instances (no DB session needed).
"""

from decimal import Decimal

from app.models.order_item import (
    BillingType,
    DeliveryMethod,
    FulfillmentType,
    Publication,
    PublicationFormat,
    SubscriptionTerm,
)
from app.models.product import CoverageRule, Product
from app.services.product_resolver_service import match_product, resolve_product


def _catalog():
    return [
        Product(
            code="CBJ-SUB-1Y-PROMO",
            display_name="《中国经营报》全年订阅-618促销活动",
            aliases=["618促销活动", "双十一订阅优惠"],
            publication=Publication.cbj,
            publication_format=PublicationFormat.paper,
            fulfillment_type=FulfillmentType.subscription,
            subscription_term=SubscriptionTerm.one_year,
            delivery_method=DeliveryMethod.post_office,
            billing_type=BillingType.paid,
            coverage_rule=CoverageRule.term_from_month,
            is_bundle=False,
            active=True,
        ),
        Product(
            code="CBJ-LATEST",
            display_name="《中国经营报》最新一期订阅",
            publication=Publication.cbj,
            publication_format=PublicationFormat.paper,
            fulfillment_type=FulfillmentType.single_issue,
            delivery_method=DeliveryMethod.post_office,
            billing_type=BillingType.paid,
            coverage_rule=CoverageRule.latest_issue,
            is_bundle=False,
            active=True,
        ),
        Product(
            code="CBJ-BS-BUNDLE-1Y",
            display_name="《中国经营报》和《商学院》全年订阅（8折优惠）",
            aliases=["8折优惠"],
            publication=None,
            publication_format=PublicationFormat.paper,
            fulfillment_type=FulfillmentType.subscription,
            subscription_term=SubscriptionTerm.one_year,
            delivery_method=DeliveryMethod.post_office,
            billing_type=BillingType.paid,
            coverage_rule=CoverageRule.term_from_month,
            is_bundle=True,
            components=[
                {"publication": "cbj", "subscription_term": "one_year",
                 "coverage_rule": "term_from_month", "fixed_price": 240},
                {"publication": "business_school", "subscription_term": "one_year",
                 "coverage_rule": "term_from_month", "remainder": True},
            ],
            active=True,
        ),
    ]


def test_exact_match_copies_attributes_and_actual_price():
    res = resolve_product(_catalog(), "《中国经营报》全年订阅-618促销活动", 1, Decimal("199"))
    assert res.matched and res.product_code == "CBJ-SUB-1Y-PROMO"
    assert len(res.items) == 1
    r = res.items[0]
    assert r.coverage_rule == CoverageRule.term_from_month
    assert r.item.publication == Publication.cbj
    assert r.item.fulfillment_type == FulfillmentType.subscription
    assert r.item.subscription_term == SubscriptionTerm.one_year
    assert r.item.delivery_method == DeliveryMethod.post_office
    assert r.item.unit_price == Decimal("199.00")
    assert r.item.subtotal == Decimal("199.00")
    assert r.item.total_quantity == 1
    # coverage is left for the import layer (batch settings) to fill
    assert r.item.coverage_start_date is None
    assert r.item.targets == []


def test_alias_substring_match():
    res = resolve_product(_catalog(), "《中国经营报》双十一订阅优惠", 1, Decimal("240"))
    assert res.matched and res.product_code == "CBJ-SUB-1Y-PROMO"


def test_single_issue_match():
    res = resolve_product(_catalog(), "《中国经营报》最新一期订阅", 1, Decimal("5"))
    assert res.matched and res.product_code == "CBJ-LATEST"
    assert res.items[0].item.fulfillment_type == FulfillmentType.single_issue
    assert res.items[0].coverage_rule == CoverageRule.latest_issue
    assert res.items[0].item.unit_price == Decimal("5.00")


def test_bundle_fan_out_576_fixed_plus_remainder():
    res = resolve_product(_catalog(), "《中国经营报》和《商学院》全年订阅（8折优惠）", 1, Decimal("576"))
    assert res.matched and len(res.items) == 2
    by_pub = {r.item.publication: r.item for r in res.items}
    assert by_pub[Publication.cbj].subtotal == Decimal("240.00")
    assert by_pub[Publication.business_school].subtotal == Decimal("336.00")
    assert by_pub[Publication.cbj].subtotal + by_pub[Publication.business_school].subtotal == Decimal("576.00")
    assert not res.warnings


def test_bundle_fan_out_612():
    res = resolve_product(_catalog(), "《中国经营报》和《商学院》全年订阅（8折优惠）", 1, Decimal("612"))
    by_pub = {r.item.publication: r.item for r in res.items}
    assert by_pub[Publication.cbj].subtotal == Decimal("240.00")
    assert by_pub[Publication.business_school].subtotal == Decimal("372.00")


def test_unmatched_routes_to_queue():
    res = resolve_product(_catalog(), "《中国经营报》季度尝鲜装", 1, Decimal("168"))
    assert res.matched is False
    assert res.items == []
    assert "无匹配" in res.reason


def test_quantity_gt_one_derives_unit_price():
    res = resolve_product(_catalog(), "《中国经营报》全年订阅-618促销活动", 2, Decimal("398"))
    item = res.items[0].item
    assert item.total_quantity == 2
    assert item.unit_price == Decimal("199.00")
    assert item.subtotal == Decimal("398.00")


def test_bundle_negative_remainder_warns():
    # paid 200 < fixed 240 → remainder negative, flagged for review.
    res = resolve_product(_catalog(), "8折优惠", 1, Decimal("200"))
    assert res.matched
    assert res.warnings and "余额为负" in res.warnings[0]
    by_pub = {r.item.publication: r.item for r in res.items}
    assert by_pub[Publication.business_school].subtotal == Decimal("-40.00")


def test_match_product_priority_exact_over_substring():
    # The bundle string must resolve to the bundle (exact), not the promo product
    # whose alias '8折优惠' is a substring.
    p = match_product(_catalog(), "《中国经营报》和《商学院》全年订阅（8折优惠）")
    assert p is not None and p.code == "CBJ-BS-BUNDLE-1Y"


def _standalone_bs():
    return Product(
        code="BS-SUB-1Y",
        display_name="《商学院》全年订阅",
        publication=Publication.business_school,
        publication_format=PublicationFormat.paper,
        fulfillment_type=FulfillmentType.subscription,
        subscription_term=SubscriptionTerm.one_year,
        delivery_method=DeliveryMethod.post_office,
        billing_type=BillingType.paid,
        coverage_rule=CoverageRule.term_from_month,
        is_bundle=False,
        active=True,
    )


def test_standalone_line_does_not_substring_match_bundle():
    # Regression: a lone 《商学院》全年订阅 line must NOT match the CBJ+商学院 bundle
    # just because the bundle display_name literally contains it. With no standalone
    # 商学院 product in the catalog it routes to the 待确认 queue rather than being
    # silently fanned out into a 中国经营报 240 + 商学院 remainder split.
    assert match_product(_catalog(), "《商学院》全年订阅") is None
    res = resolve_product(_catalog(), "《商学院》全年订阅", 1, Decimal("480"))
    assert res.matched is False
    assert res.items == []
    assert "无匹配" in res.reason


def test_standalone_business_school_matches_standalone_product_not_bundle():
    # With the standalone product present it resolves to a SINGLE 商学院 item at
    # the actual paid price — not a 2-item bundle split.
    catalog = _catalog() + [_standalone_bs()]
    res = resolve_product(catalog, "《商学院》全年订阅", 1, Decimal("480"))
    assert res.matched and res.product_code == "BS-SUB-1Y"
    assert len(res.items) == 1
    item = res.items[0].item
    assert item.publication == Publication.business_school
    assert item.fulfillment_type == FulfillmentType.subscription
    assert item.subscription_term == SubscriptionTerm.one_year
    assert item.unit_price == Decimal("480.00")
    assert item.subtotal == Decimal("480.00")


def test_real_bundle_still_resolves_after_standalone_added():
    # Guard: adding the standalone 商学院 product must not steal the real bundle
    # string — the exact-match tier still wins it for the bundle.
    catalog = _catalog() + [_standalone_bs()]
    res = resolve_product(catalog, "《中国经营报》和《商学院》全年订阅（8折优惠）", 1, Decimal("576"))
    assert res.matched and res.product_code == "CBJ-BS-BUNDLE-1Y"
    assert len(res.items) == 2
