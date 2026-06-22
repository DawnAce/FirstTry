"""Seed the product catalog (商品库) with the known CBJ 小程序 products.

These rows come from the real CBJ 小程序 export — the 618 promo, single-issue /
back-issue retail, the regular 全年/半年订阅 by 邮局/中通 delivery, the standalone
《商学院》全年订阅, and the 双刊 bundle. Operators maintain the catalog from the
admin UI afterwards — a new promo is a row insert, not code.

Note: per-issue 商学院 monthly issues ("2026年X月刊《…》") are intentionally NOT
seeded — their title changes every issue and carries no stable catalog key, so
they are handled by import-time quick-add per issue rather than a catalog row.
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
        # 中性名：具体活动（618 / 双十一 / …）是订单 campaign 字段的事，不焊进商品名
        # （否则等同"跟着活动走"，明年换个活动就对不上）。旧名与各活动后缀保留为 alias，
        # 导入时按子串照常命中；活动区分靠 order.campaign（带年，可按活动/按年聚合）。
        display_name="《中国经营报》全年订阅（促销价）",
        aliases=[
            "618促销活动",
            "双十一订阅优惠",
            "《中国经营报》全年订阅-618促销活动",
        ],
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
    # 全年订阅（标准价，非促销）——邮局周投 ¥240 / 中通周送 ¥390。投递从商品名定，可按单改。
    dict(
        code="CBJ-SUB-1Y-POST",
        display_name="《中国经营报》全年订阅（邮局周投）",
        publication=Publication.cbj,
        fulfillment_type=FulfillmentType.subscription,
        subscription_term=SubscriptionTerm.one_year,
        delivery_method=DeliveryMethod.post_office,
        coverage_rule=CoverageRule.term_from_month,
        list_price=Decimal("240"),
    ),
    dict(
        code="CBJ-SUB-1Y-ZTO",
        display_name="《中国经营报》全年订阅（中通 周送）",
        publication=Publication.cbj,
        fulfillment_type=FulfillmentType.subscription,
        subscription_term=SubscriptionTerm.one_year,
        delivery_method=DeliveryMethod.zto_mf,
        coverage_rule=CoverageRule.term_from_month,
        list_price=Decimal("390"),
    ),
    # 中通「月送」：与「周送」同为 zto_mf 投递，但寄送频次/价不同（¥240 vs ¥390）。频次
    # 目前只体现在商品名与价上（DeliveryMethod 枚举尚未建模 周/月 频次）；若日后要按频次
    # 结构化统计，再单加字段。源自真实订单行"《中国经营报》全年订阅（中通 月送）"。
    dict(
        code="CBJ-SUB-1Y-ZTO-M",
        display_name="《中国经营报》全年订阅（中通 月送）",
        publication=Publication.cbj,
        fulfillment_type=FulfillmentType.subscription,
        subscription_term=SubscriptionTerm.one_year,
        delivery_method=DeliveryMethod.zto_mf,
        coverage_rule=CoverageRule.term_from_month,
        list_price=Decimal("240"),
    ),
    # 半年订阅——邮局周投 ¥120 / 中通周送 ¥195。
    dict(
        code="CBJ-SUB-6M-POST",
        display_name="《中国经营报》半年订阅（邮局周投）",
        publication=Publication.cbj,
        fulfillment_type=FulfillmentType.subscription,
        subscription_term=SubscriptionTerm.half_year,
        delivery_method=DeliveryMethod.post_office,
        coverage_rule=CoverageRule.term_from_month,
        list_price=Decimal("120"),
    ),
    dict(
        code="CBJ-SUB-6M-ZTO",
        display_name="《中国经营报》半年订阅（中通 周送）",
        publication=Publication.cbj,
        fulfillment_type=FulfillmentType.subscription,
        subscription_term=SubscriptionTerm.half_year,
        delivery_method=DeliveryMethod.zto_mf,
        coverage_rule=CoverageRule.term_from_month,
        list_price=Decimal("195"),
    ),
    # 单期·往期零售（具体期号由操作员按单补；价格随期不同，list_price 仅参考）。
    dict(
        code="CBJ-BACKISSUE",
        display_name="《中国经营报》单期 往期零售",
        publication=Publication.cbj,
        fulfillment_type=FulfillmentType.single_issue,
        delivery_method=DeliveryMethod.post_office,
        coverage_rule=CoverageRule.custom,
        list_price=Decimal("10"),
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
