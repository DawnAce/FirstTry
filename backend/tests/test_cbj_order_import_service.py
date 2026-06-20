"""Tests for build_import_preview (Phase 3b-3 core orchestration)."""

from datetime import date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Order, OrderCommercialStatus, OrderEntryMethod, OrderStatus
from app.models.order_item import DeliveryMethod, Publication
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


def _line(name, qty=1, price=Decimal("199"), shipping=False, zto=False):
    return ProductLine(
        raw=name, name=name, quantity=qty, unit_price=price, is_shipping=shipping, mentions_zto=zto
    )


def _po(*, ext="EC-1", status="卖家已发货", paid=Decimal("199"),
        order_date=date(2026, 6, 1), payment_time=datetime(2026, 6, 1, 13, 0, 0), lines=None):
    return ParsedOrder(
        external_order_no=ext, status_raw=status, paid_amount=paid, original_amount=paid,
        order_date=order_date, payment_time=payment_time, payment_method_raw="微信", invoice_raw="",
        recipient_name="冯志强", recipient_phone="15103569527", recipient_address="某地址",
        recipient_postal_code="048000", notes="",
        product_lines=lines or [_line("《中国经营报》全年订阅-618促销活动")],
    )


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
