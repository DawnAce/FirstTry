"""Seed the product catalog (商品库) with the known CBJ 小程序 products.

These three rows come from the real CBJ 小程序 export. Operators maintain the
catalog from the admin UI afterwards — a new promo is a row insert, not code.
"""

from decimal import Decimal

from sqlalchemy.orm import Session

from app.models import Product
from app.models.order_item import (
    DeliveryMethod,
    FulfillmentType,
    Publication,
    SubscriptionTerm,
)
from app.models.product import CoverageRule


PRODUCTS = [
    # 全年订阅（促销价 ¥199）。起投时间不固定（每批人为设定），故 term_from_month
    # 只表示"从某个起投月算一年"，起投月由导入批次设置提供。
    dict(
        code="CBJ-SUB-1Y-PROMO",
        display_name="《中国经营报》全年订阅-618促销活动",
        aliases=["618促销活动", "双十一订阅优惠"],
        publication=Publication.cbj,
        fulfillment_type=FulfillmentType.subscription,
        subscription_term=SubscriptionTerm.one_year,
        delivery_method=DeliveryMethod.post_office,
        coverage_rule=CoverageRule.term_from_month,
        list_price=Decimal("199"),
    ),
    # 最新一期（单期 ¥5）。
    dict(
        code="CBJ-LATEST",
        display_name="《中国经营报》最新一期订阅",
        publication=Publication.cbj,
        fulfillment_type=FulfillmentType.single_issue,
        delivery_method=DeliveryMethod.post_office,
        coverage_rule=CoverageRule.latest_issue,
        list_price=Decimal("5"),
    ),
    # 《商学院》全年订阅（单刊，¥480）。必须作为独立商品存在：否则纯商学院订单会被
    # 双刊套餐名（字面含“《商学院》全年订阅”）子串误匹配、无声拆成中国经营报+商学院。
    # 投递默认邮局，可按单/按品改。
    dict(
        code="BS-SUB-1Y",
        display_name="《商学院》全年订阅",
        publication=Publication.business_school,
        fulfillment_type=FulfillmentType.subscription,
        subscription_term=SubscriptionTerm.one_year,
        delivery_method=DeliveryMethod.post_office,
        coverage_rule=CoverageRule.term_from_month,
        list_price=Decimal("480"),
    ),
    # 双刊套餐（8折 ¥576）→ 拆两条明细：中国经营报固定 ¥240，商学院拿余额。
    dict(
        code="CBJ-BS-BUNDLE-1Y",
        display_name="《中国经营报》和《商学院》全年订阅（8折优惠）",
        aliases=["8折优惠"],
        publication=None,
        fulfillment_type=FulfillmentType.subscription,
        subscription_term=SubscriptionTerm.one_year,
        delivery_method=DeliveryMethod.post_office,
        coverage_rule=CoverageRule.term_from_month,
        list_price=Decimal("576"),
        is_bundle=True,
        components=[
            {
                "publication": "cbj",
                "subscription_term": "one_year",
                "coverage_rule": "term_from_month",
                "fixed_price": 240,
            },
            {
                "publication": "business_school",
                "subscription_term": "one_year",
                "coverage_rule": "term_from_month",
                "remainder": True,
            },
        ],
    ),
]


def seed_products(db: Session) -> int:
    """Insert the seed products if the catalog is empty. Idempotent."""
    if db.query(Product).count() > 0:
        return 0
    count = 0
    for row in PRODUCTS:
        db.add(Product(**row))
        count += 1
    db.commit()
    return count
