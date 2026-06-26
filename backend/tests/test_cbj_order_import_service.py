"""Tests for build_import_preview (Phase 3b-3 core orchestration)."""

from datetime import date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Order, OrderCommercialStatus, OrderEntryMethod, OrderStatus
from app.models.order_item import BillingType, DeliveryMethod, FulfillmentType, Publication
from app.models.publication_schedule import PublicationSchedule
from app.seeds.products import seed_products
from app.services.cbj_order_import_parser import ParsedOrder, ProductLine
from app.services.cbj_order_import_service import BatchSettings, build_import_preview


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    seed_products(session)
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


RECENT = BatchSettings(
    mode="recent",
    post_office_start_month="2026-07",
    zto_start_month="2026-07",
    cutoff_date=date(2026, 6, 22),
)

# A 618-style batch: campaign tag + 1 bonus month + a 商学院 gift issue.
GIFT = BatchSettings(
    mode="recent",
    post_office_start_month="2026-07",
    zto_start_month="2026-07",
    cutoff_date=date(2026, 6, 22),
    campaign="2026-618",
    bonus_months=1,
    gift_publication="business_school",
    gift_note="《商学院》2-3月合刊（2026-618）",
)


def _line(name, qty=1, price=Decimal("199"), shipping=False, zto=False):
    return ProductLine(
        raw=name, name=name, quantity=qty, unit_price=price, is_shipping=shipping, mentions_zto=zto
    )


def _po(*, ext="EC-1", status="卖家已发货", paid=Decimal("199"), original=None,
        order_date=date(2026, 6, 1), payment_time=datetime(2026, 6, 1, 13, 0, 0), lines=None):
    return ParsedOrder(
        external_order_no=ext, status_raw=status, paid_amount=paid,
        original_amount=original if original is not None else paid,
        order_date=order_date, payment_time=payment_time, payment_method_raw="微信", invoice_raw="",
        recipient_name="冯志强", recipient_phone="15103569527", recipient_address="某地址",
        recipient_postal_code="048000", notes="",
        product_lines=lines or [_line("《中国经营报》全年订阅-618促销活动")],
    )


def test_ignored_product_skipped(db):
    # 忽略名单里的特殊品（家族企业等）→ 跳过，不导入、不进待确认
    pv = build_import_preview(db, [_po(lines=[_line("《家族企业》全年订阅", price=Decimal("600"))])], RECENT)
    assert pv.rows[0].decision == "skip_status"
    assert "已忽略" in pv.rows[0].reason


def test_ignored_line_dropped_keeps_rest_in_multi_product(db):
    # 多商品单：忽略行（深度系列）被丢弃，其余（套餐）照常导入
    lines = [
        _line("《中国经营报》和《商学院》全年订阅（8折优惠）", price=Decimal("576")),
        _line("《商学院》深度系列实战案例辑4册", price=Decimal("218")),
    ]
    pv = build_import_preview(db, [_po(paid=Decimal("794"), lines=lines)], RECENT)
    assert pv.rows[0].decision == "import"
    pubs = {it.publication.value for it in pv.rows[0].order_create.items if it.publication}
    assert pubs == {"cbj", "business_school"}  # 套餐拆 2 条；深度系列行已忽略


def test_normal_order_imports_with_computed_coverage(db):
    pv = build_import_preview(db, [_po()], RECENT)
    row = pv.rows[0]
    assert row.decision == "import"
    assert row.commercial_status == OrderCommercialStatus.shipped
    oc = row.order_create
    assert oc.payer_name == "冯志强"
    assert oc.total_amount == Decimal("199")
    item = oc.items[0]
    assert item.publication == Publication.cbj
    assert item.delivery_method == DeliveryMethod.post_office
    # paid 6/1 (before cutoff 6/22) → start 2026-07, one year
    assert item.coverage_start_date == date(2026, 7, 1)
    assert item.coverage_end_date == date(2027, 6, 30)
    assert item.targets[0].recipient_name == "冯志强"
    assert item.targets[0].recipient_postal_code == "048000"


def test_late_payment_shifts_start_month(db):
    pv = build_import_preview(
        db, [_po(payment_time=datetime(2026, 6, 25, 9, 0, 0))], RECENT
    )
    item = pv.rows[0].order_create.items[0]
    # paid 6/25 (after cutoff 6/22) → start 2026-08
    assert item.coverage_start_date == date(2026, 8, 1)
    assert item.coverage_end_date == date(2027, 7, 31)


def test_shipping_line_folds_into_total_and_flips_delivery_to_zto(db):
    lines = [
        _line("《中国经营报》全年订阅-618促销活动", qty=1, price=Decimal("199")),
        _line("《中国经营报》运费补拍（邮局转中通）", qty=50, price=Decimal("3"),
              shipping=True, zto=True),
    ]
    pv = build_import_preview(db, [_po(paid=Decimal("349"), lines=lines)], RECENT)
    row = pv.rows[0]
    assert row.decision == "import"
    assert row.delivery_overridden_to_zto is True
    item = row.order_create.items[0]
    assert item.delivery_method == DeliveryMethod.zto_mf
    # line paid = 349 − (50×3) = 199
    assert item.subtotal == Decimal("199.00")
    # order total keeps the full paid amount (freight included)
    assert row.order_create.total_amount == Decimal("349")


def test_bundle_fans_into_two_items(db):
    lines = [_line("《中国经营报》和《商学院》全年订阅（8折优惠）", qty=1, price=Decimal("576"))]
    pv = build_import_preview(db, [_po(paid=Decimal("576"), lines=lines)], RECENT)
    items = pv.rows[0].order_create.items
    assert len(items) == 2
    by_pub = {i.publication: i for i in items}
    assert by_pub[Publication.cbj].subtotal == Decimal("240.00")
    assert by_pub[Publication.business_school].subtotal == Decimal("336.00")


def test_pending_payment_skipped(db):
    pv = build_import_preview(db, [_po(status="待付款")], RECENT)
    assert pv.rows[0].decision == "skip_status"


def test_duplicate_external_order_no_skipped(db):
    db.add(Order(order_date=date(2026, 1, 1), entry_method=OrderEntryMethod.excel_import,
                 payer_name="老的", external_order_no="EC-DUP", status=OrderStatus.active))
    db.commit()
    pv = build_import_preview(db, [_po(ext="EC-DUP")], RECENT)
    assert pv.rows[0].decision == "duplicate"


def test_unknown_product_routes_to_unresolved(db):
    lines = [_line("《中国经营报》季度尝鲜装", qty=1, price=Decimal("168"))]
    pv = build_import_preview(db, [_po(paid=Decimal("168"), lines=lines)], RECENT)
    assert pv.rows[0].decision == "unresolved"
    assert "无匹配" in pv.rows[0].reason


def test_historical_mode_leaves_coverage_blank(db):
    historical = BatchSettings(mode="historical")
    pv = build_import_preview(db, [_po(order_date=date(2024, 9, 12))], historical)
    item = pv.rows[0].order_create.items[0]
    assert item.coverage_start_date is None
    assert item.coverage_end_date is None


def test_counts_summary(db):
    orders = [_po(ext="A"), _po(ext="B", status="待付款"),
              _po(ext="C", lines=[_line("未知商品", price=Decimal("9"))])]
    pv = build_import_preview(db, orders, RECENT)
    c = pv.counts
    assert c["total"] == 3 and c["import"] == 1 and c["skip_status"] == 1 and c["unresolved"] == 1


# ---------------------------------------------------------------------------
# Campaign tag + activity gifts (延长月 / 赠送刊物)
# ---------------------------------------------------------------------------


def test_campaign_tag_written_to_order(db):
    pv = build_import_preview(db, [_po()], GIFT)
    assert pv.rows[0].order_create.campaign == "2026-618"


def test_bonus_months_extend_subscription_coverage(db):
    pv = build_import_preview(db, [_po()], GIFT)
    sub = pv.rows[0].order_create.items[0]
    # one year + 1 bonus month: 2026-07-01 → 2027-07-31 (13 months)
    assert sub.coverage_start_date == date(2026, 7, 1)
    assert sub.coverage_end_date == date(2027, 7, 31)


def test_gift_item_appended_to_subscription_order(db):
    pv = build_import_preview(db, [_po()], GIFT)
    items = pv.rows[0].order_create.items
    gifts = [i for i in items if i.billing_type == BillingType.free_gift]
    assert len(gifts) == 1
    gift = gifts[0]
    assert gift.publication == Publication.business_school
    assert gift.fulfillment_type == FulfillmentType.gift
    assert gift.unit_price == Decimal("0")
    assert gift.subtotal == Decimal("0")
    assert gift.total_quantity == 1
    assert gift.notes == "《商学院》2-3月合刊（2026-618）"
    # gift ships to the same recipient as the main order
    assert gift.targets[0].recipient_name == "冯志强"
    assert gift.targets[0].quantity == 1


def test_gift_not_added_to_single_issue_only_order(db):
    lines = [_line("《中国经营报》最新一期订阅", qty=1, price=Decimal("5"))]
    pv = build_import_preview(db, [_po(paid=Decimal("5"), lines=lines)], GIFT)
    oc = pv.rows[0].order_create
    # campaign is still tagged, but a single-issue order isn't the campaign subject
    assert oc.campaign == "2026-618"
    assert all(i.billing_type != BillingType.free_gift for i in oc.items)


def test_no_gift_or_bonus_when_not_configured(db):
    pv = build_import_preview(db, [_po()], RECENT)
    oc = pv.rows[0].order_create
    assert oc.campaign is None
    assert all(i.billing_type != BillingType.free_gift for i in oc.items)
    # plain one year, no bonus month
    assert oc.items[0].coverage_end_date == date(2027, 6, 30)


def test_business_school_monthly_issue_auto_recognized(db):
    # 商学院月刊单期不在商品库里，但应按 "YYYY年X月刊" 自动识别为商学院单期，
    # 期次身份落 issue_label —— 不在商品库建带年份的行。
    lines = [_line("2026年1月刊《AI赋能，乡村新生》", qty=1, price=Decimal("40"))]
    pv = build_import_preview(db, [_po(paid=Decimal("40"), lines=lines)], RECENT)
    row = pv.rows[0]
    assert row.decision == "import"
    item = row.order_create.items[0]
    assert item.publication == Publication.business_school
    assert item.fulfillment_type == FulfillmentType.single_issue
    assert item.issue_label == "2026-01"
    assert item.subtotal == Decimal("40.00")
    # single issue → no subscription coverage window
    assert item.coverage_start_date is None
    assert item.coverage_end_date is None


def test_combined_monthly_issue_gets_range_label(db):
    lines = [_line("2026年2~3月合刊《AI+知识产权，迎接新规则时代》", qty=1, price=Decimal("40"))]
    pv = build_import_preview(db, [_po(paid=Decimal("40"), lines=lines)], RECENT)
    item = pv.rows[0].order_create.items[0]
    assert item.fulfillment_type == FulfillmentType.single_issue
    assert item.issue_label == "2026-02~03"


def test_truly_unknown_product_still_unresolved(db):
    # the monthly-issue fallback must NOT swallow genuinely unrecognised products.
    lines = [_line("某某神秘商品", qty=1, price=Decimal("99"))]
    pv = build_import_preview(db, [_po(paid=Decimal("99"), lines=lines)], RECENT)
    assert pv.rows[0].decision == "unresolved"


def test_dated_non_issue_lines_not_misbooked_as_business_school(db):
    # A dated line that is NOT a 月刊/合刊, or that names 中国经营报, must stay 待确认 —
    # never get silently booked as a 商学院 single issue (mis-attribution + queue bypass).
    for name in ["2026年1月新春礼包", "《中国经营报》2026年1月特刊"]:
        pv = build_import_preview(db, [_po(paid=Decimal("88"), lines=[_line(name)])], RECENT)
        assert pv.rows[0].decision == "unresolved", name


def test_importer_persists_original_amount_separately(db):
    # 原价（折前）must be stored on the order; total_amount stays equal to paid.
    pv = build_import_preview(db, [_po(paid=Decimal("199"), original=Decimal("240"))], RECENT)
    oc = pv.rows[0].order_create
    assert oc.paid_amount == Decimal("199")
    assert oc.total_amount == Decimal("199")
    assert oc.original_amount == Decimal("240")


def test_zto_override_does_not_stamp_business_school_single_issue(db):
    # Mixed order: a 中通 subscription + a 商学院 monthly issue. The single issue is created
    # with delivery=None and must NOT get 中通 auto-stamped onto it.
    lines = [
        _line("《中国经营报》全年订阅（中通 周送）", qty=1, price=Decimal("390"), zto=True),
        _line("2026年1月刊《AI赋能，乡村新生》", qty=1, price=Decimal("40")),
    ]
    pv = build_import_preview(db, [_po(paid=Decimal("430"), lines=lines)], RECENT)
    row = pv.rows[0]
    assert row.decision == "import"
    items = {i.publication: i for i in row.order_create.items}
    assert items[Publication.cbj].delivery_method == DeliveryMethod.zto_mf
    bs = items[Publication.business_school]
    assert bs.fulfillment_type == FulfillmentType.single_issue
    assert bs.issue_label == "2026-01"
    assert bs.delivery_method is None


def _cbj_weekly_schedule(db):
    db.add_all([
        PublicationSchedule(year=2026, issue_number=2625, publish_date=date(2026, 6, 15)),
        PublicationSchedule(year=2026, issue_number=2626, publish_date=date(2026, 6, 22)),
    ])
    db.commit()


def test_latest_issue_assigns_issue_number_from_payment_time(db):
    _cbj_weekly_schedule(db)
    # Wed 6-17 → clearly inside the 6-15 issue's window; clean auto-assign, no flag.
    po = _po(
        paid=Decimal("5"),
        lines=[_line("《中国经营报》最新一期订阅", price=Decimal("5"))],
        payment_time=datetime(2026, 6, 17, 10, 0),
    )
    pv = build_import_preview(db, [po], RECENT)
    row = pv.rows[0]
    assert row.decision == "import"
    item = row.order_create.items[0]
    assert item.fulfillment_type == FulfillmentType.single_issue
    assert item.issue_number == 2625
    assert not any("翻期临界" in w for w in row.warnings)


def test_back_issue_order_flags_missing_issue_number(db):
    # 往期零售（自定义单期）：导入留空期号 + 标黄提醒补（期号靠客服告知，不在订单里）。
    po = _po(
        paid=Decimal("10"),
        lines=[_line("《中国经营报》单期 往期零售", price=Decimal("10"))],
    )
    pv = build_import_preview(db, [po], RECENT)
    row = pv.rows[0]
    assert row.decision == "import"
    item = row.order_create.items[0]
    assert item.fulfillment_type == FulfillmentType.single_issue
    assert item.issue_number is None
    assert any("往期单" in w for w in row.warnings)


def test_latest_issue_borderline_friday_night_flags(db):
    _cbj_weekly_schedule(db)
    # Fri 6-19 23:00 → after the ~22:00 flip → upcoming 6-22 issue, within ±4h → flagged.
    po = _po(
        paid=Decimal("5"),
        lines=[_line("《中国经营报》最新一期订阅", price=Decimal("5"))],
        payment_time=datetime(2026, 6, 19, 23, 0),
    )
    pv = build_import_preview(db, [po], RECENT)
    row = pv.rows[0]
    assert row.order_create.items[0].issue_number == 2626
    assert any("翻期临界" in w for w in row.warnings)
