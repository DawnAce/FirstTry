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
        # 淘宝 SKU「分册名:全年-邮局-周投」靠该子串区分投递（标题不带投递信息）。
        aliases=["全年-邮局"],
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
        aliases=["全年-快递-周寄", "全年-快递-周送"],
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
        aliases=["全年-快递-月寄"],
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
        aliases=["半年-邮局"],
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
        aliases=["半年-快递"],
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
        # 淘宝「单期零售《中国经营报》…」标题映射到往期零售（custom 期号→导入留空 + 标黄补）。
        aliases=["单期零售《中国经营报》刊社直发正品保证商业财经经济时政新闻热点资讯报刊"],
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
    # 淘宝《商学院》全年「一期一发快递发货」——与上面邮局周送的 BS-SUB-1Y 同刊不同投递，
    # 单列一条（中通）。SKU「分册名:全年订阅」靠完整标题+「全年订阅」别名区分于季度。
    # 覆盖期「自由起订时间，下单备注」→ custom（导入留空，操作员按备注补）。
    dict(
        code="BS-SUB-1Y-ZTO",
        display_name="《商学院》全年订阅（中通·一期一发）",
        aliases=["一期一发快递发货《商学院》杂志订阅商业财经经济热点资讯期刊全年订阅"],
        publication=Publication.business_school,
        fulfillment_type=FulfillmentType.subscription,
        subscription_term=SubscriptionTerm.one_year,
        delivery_method=DeliveryMethod.zto_mf,
        coverage_rule=CoverageRule.custom,
        list_price=Decimal("480"),
    ),
    # 淘宝《商学院》季度订阅（中通·一期一发）。季度无独立 SubscriptionTerm 枚举 → custom；
    # 覆盖期同为自由起订 → CoverageRule.custom（导入留空，操作员补）。list_price 仅参考。
    dict(
        code="BS-SUB-QTR-ZTO",
        display_name="《商学院》季度订阅（中通·一期一发）",
        aliases=["一期一发快递发货《商学院》杂志订阅商业财经经济热点资讯期刊季度订阅"],
        publication=Publication.business_school,
        fulfillment_type=FulfillmentType.subscription,
        subscription_term=SubscriptionTerm.custom,
        delivery_method=DeliveryMethod.zto_mf,
        coverage_rule=CoverageRule.custom,
        list_price=Decimal("315"),
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


def sync_catalog(db: Session) -> dict:
    """Additively reconcile an EXISTING catalog with the seed definitions.

    ``seed_products`` only fills an empty catalog, so production (already seeded)
    never picks up newly-added aliases / products. This is the idempotent upsert
    for that case: it **adds missing aliases** to existing products (union, never
    removes) and **inserts new products** by code — but never edits other fields of
    products an operator may have customized. Safe to run repeatedly.

    Returns counts of what changed.

    ⚠️ Matches by ``code``, so it only reconciles a catalog that shares the seed's
    product codes (i.e. one originally built by ``seed_products``). A hand-curated
    catalog whose products were added via the UI has auto-generated codes that do
    NOT match the seed — running this against it would INSERT every seed row as a
    duplicate. For that case, apply aliases/products with a targeted, display-name
    matched one-off instead. Hence this is intentionally NOT wired into the admin
    seed endpoint.
    """
    by_code = {p.code: p for p in db.query(Product).all()}
    added_products = 0
    aliases_added = 0
    for row in PRODUCTS:
        existing = by_code.get(row["code"])
        if existing is None:
            db.add(Product(**row))
            added_products += 1
            continue
        seed_aliases = row.get("aliases") or []
        if not seed_aliases:
            continue
        current = list(existing.aliases or [])
        missing = [a for a in seed_aliases if a not in current]
        if missing:
            existing.aliases = current + missing  # reassign so JSON change is tracked
            aliases_added += len(missing)
    db.commit()
    return {"added_products": added_products, "aliases_added": aliases_added}
