"""Seed the product catalog (商品库).

These 13 rows mirror the live (operator-curated) catalog: a consistent
**三段式 display_name**（`刊物 · 套餐 · 投递频次`）+ structured `code`
（`CBJ-1Y-POST-WK` 等），with every platform export string kept in `aliases`
so import matching is decoupled from the human-facing name.

Alias convention (important): `aliases` carries ALL strings an e-commerce export
might use to refer to this product — the legacy display name(s) AND the 淘宝 SKU
tokens (`全年-邮局`、`分册名` 片段). Renaming `display_name` never breaks matching
because the old name lives on as an alias. New platform names → add an alias,
never rename a matching string away.

促销品 (`*-PROMO`) 用活动中性名「促销价」+ 完整活动串别名（如「…-618促销活动」，
**不要**用裸 `618`——中国经营报/商学院都有 618 会互相误命中）；具体活动归
`order.campaign`，实付按单记。

NOT seeded (handled automatically, never a catalog row):
* 商学院月刊单期 ("2026年X月刊《…》"/合刊) → import-time auto-detection (issue_label).
* 运费补拍 ("…运费补拍…") → parser treats it as a shipping line (is_shipping).
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
    # ---- 《中国经营报》订阅 ----
    dict(
        code="CBJ-1Y-POST-WK",
        display_name="中国经营报 · 全年订阅 · 邮局周投",
        aliases=["全年-邮局", "《中国经营报》全年订阅（邮局周投）"],
        publication=Publication.cbj,
        fulfillment_type=FulfillmentType.subscription,
        subscription_term=SubscriptionTerm.one_year,
        delivery_method=DeliveryMethod.post_office,
        coverage_rule=CoverageRule.term_from_month,
        list_price=Decimal("240"),
    ),
    dict(
        code="CBJ-1Y-ZTO-WK",
        display_name="中国经营报 · 全年订阅 · 中通周送",
        aliases=["全年-快递-周寄", "全年-快递-周送", "《中国经营报》全年订阅（中通 周送）"],
        publication=Publication.cbj,
        fulfillment_type=FulfillmentType.subscription,
        subscription_term=SubscriptionTerm.one_year,
        delivery_method=DeliveryMethod.zto_mf,
        coverage_rule=CoverageRule.term_from_month,
        list_price=Decimal("390"),
    ),
    dict(
        code="CBJ-1Y-ZTO-MO",
        display_name="中国经营报 · 全年订阅 · 中通月送",
        aliases=["全年-快递-月寄", "《中国经营报》全年订阅（中通 月送）"],
        publication=Publication.cbj,
        fulfillment_type=FulfillmentType.subscription,
        subscription_term=SubscriptionTerm.one_year,
        delivery_method=DeliveryMethod.zto_mf,
        coverage_rule=CoverageRule.term_from_month,
        list_price=Decimal("240"),
    ),
    # 促销价：完整活动串别名；具体活动（618/双十一）归 order.campaign，不焊进商品名。
    dict(
        code="CBJ-1Y-PROMO",
        display_name="中国经营报 · 全年订阅 · 促销价",
        aliases=["《中国经营报》全年订阅-618促销活动", "《中国经营报》全年订阅（促销价）"],
        publication=Publication.cbj,
        fulfillment_type=FulfillmentType.subscription,
        subscription_term=SubscriptionTerm.one_year,
        delivery_method=DeliveryMethod.post_office,
        coverage_rule=CoverageRule.term_from_month,
        list_price=Decimal("240"),
    ),
    dict(
        code="CBJ-6M-POST-WK",
        display_name="中国经营报 · 半年订阅 · 邮局周投",
        aliases=["半年-邮局", "《中国经营报》半年订阅（邮局周投）"],
        publication=Publication.cbj,
        fulfillment_type=FulfillmentType.subscription,
        subscription_term=SubscriptionTerm.half_year,
        delivery_method=DeliveryMethod.post_office,
        coverage_rule=CoverageRule.term_from_month,
        list_price=Decimal("120"),
    ),
    dict(
        code="CBJ-6M-ZTO-WK",
        display_name="中国经营报 · 半年订阅 · 中通周送",
        aliases=["半年-快递", "《中国经营报》半年订阅（中通 周送）"],
        publication=Publication.cbj,
        fulfillment_type=FulfillmentType.subscription,
        subscription_term=SubscriptionTerm.half_year,
        delivery_method=DeliveryMethod.zto_mf,
        coverage_rule=CoverageRule.term_from_month,
        list_price=Decimal("195"),
    ),
    # ---- 《中国经营报》单期 ----
    dict(
        code="CBJ-ISSUE-LATEST",
        display_name="中国经营报 · 单期 · 最新一期",
        aliases=["《中国经营报》最新一期订阅"],
        publication=Publication.cbj,
        fulfillment_type=FulfillmentType.single_issue,
        delivery_method=DeliveryMethod.zto_mf,
        coverage_rule=CoverageRule.latest_issue,
        list_price=Decimal("5"),
    ),
    # 往期零售：具体期号由操作员按单补（custom）。
    dict(
        code="CBJ-ISSUE-BACK",
        display_name="中国经营报 · 单期 · 往期零售",
        aliases=[
            "单期零售《中国经营报》刊社直发正品保证商业财经经济时政新闻热点资讯报刊",
            "《中国经营报》单期 往期零售",
        ],
        publication=Publication.cbj,
        fulfillment_type=FulfillmentType.single_issue,
        delivery_method=DeliveryMethod.zto_mf,
        coverage_rule=CoverageRule.custom,
        list_price=Decimal("5"),
    ),
    # ---- 《商学院》（订阅均为中通一期一发；月刊单期不建商品，自动识别）----
    # 全年必须作为独立商品存在：否则纯商学院订单会被双刊套餐名子串误匹配。
    dict(
        code="BS-1Y-ZTO",
        display_name="商学院 · 全年订阅 · 中通",
        aliases=[
            "一期一发快递发货《商学院》杂志订阅商业财经经济热点资讯期刊全年订阅",
            "《商学院》全年订阅",
        ],
        publication=Publication.business_school,
        fulfillment_type=FulfillmentType.subscription,
        subscription_term=SubscriptionTerm.one_year,
        delivery_method=DeliveryMethod.zto_mf,
        coverage_rule=CoverageRule.term_from_month,
        list_price=Decimal("480"),
    ),
    dict(
        code="BS-6M-ZTO",
        display_name="商学院 · 半年订阅 · 中通",
        aliases=["《商学院》半年订阅"],
        publication=Publication.business_school,
        fulfillment_type=FulfillmentType.subscription,
        subscription_term=SubscriptionTerm.half_year,
        delivery_method=DeliveryMethod.zto_mf,
        coverage_rule=CoverageRule.term_from_month,
        list_price=Decimal("240"),
    ),
    # 季度：无独立 SubscriptionTerm 枚举 → custom；自由起订 → coverage custom（导入留空）。
    dict(
        code="BS-QTR-ZTO",
        display_name="商学院 · 季度订阅 · 中通",
        aliases=[
            "一期一发快递发货《商学院》杂志订阅商业财经经济热点资讯期刊季度订阅",
            "《商学院》季度订阅（中通·一期一发）",
            "《商学院》季度订阅",
        ],
        publication=Publication.business_school,
        fulfillment_type=FulfillmentType.subscription,
        subscription_term=SubscriptionTerm.custom,
        delivery_method=DeliveryMethod.zto_mf,
        coverage_rule=CoverageRule.custom,
        list_price=Decimal("120"),
    ),
    dict(
        code="BS-1Y-PROMO",
        display_name="商学院 · 全年订阅 · 促销价",
        aliases=["《商学院》全年订阅-618促销活动"],
        publication=Publication.business_school,
        fulfillment_type=FulfillmentType.subscription,
        subscription_term=SubscriptionTerm.one_year,
        delivery_method=DeliveryMethod.zto_mf,
        coverage_rule=CoverageRule.term_from_month,
        list_price=Decimal("480"),
    ),
    # ---- 套餐 ----
    # 双刊 8 折 → 拆两条：中国经营报固定 ¥240（邮局）、商学院拿余额（中通）。原价 720。
    dict(
        code="BUNDLE-CBJ-BS-1Y",
        display_name="中国经营报+商学院 · 全年订阅 · 套餐8折",
        aliases=["《中国经营报》和《商学院》全年订阅（8折优惠）"],
        publication=None,
        fulfillment_type=FulfillmentType.subscription,
        subscription_term=SubscriptionTerm.one_year,
        coverage_rule=CoverageRule.term_from_month,
        list_price=Decimal("720"),
        is_bundle=True,
        components=[
            {
                "publication": "cbj",
                "coverage_rule": "term_from_month",
                "delivery_method": "post_office",
                "fixed_price": 240,
            },
            {
                "publication": "business_school",
                "coverage_rule": "term_from_month",
                "delivery_method": "zto_mf",
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
