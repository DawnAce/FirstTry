"""Tests for commercial-status mapping + the new order columns set by import."""

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import OrderCommercialStatus, OrderEntryMethod
from app.models.order_item import FulfillmentType, Publication, PublicationFormat
from app.schemas.order import FulfillmentTargetIn, OrderCreate, OrderItemIn
from app.services import order_service
from app.services.order_import_status_service import map_commercial_status


# --- mapping ----------------------------------------------------------------


def test_known_shipped_imports():
    m = map_commercial_status("卖家已发货")
    assert m.status == OrderCommercialStatus.shipped
    assert m.should_import is True and m.unknown is False


def test_known_paid_awaiting_shipment():
    m = map_commercial_status("已支付，卖家待发货")
    assert m.status == OrderCommercialStatus.paid and m.should_import is True


def test_pending_payment_skipped():
    m = map_commercial_status("待付款")
    assert m.status == OrderCommercialStatus.pending_payment and m.should_import is False


def test_cancelled_skipped():
    assert map_commercial_status("交易关闭").should_import is False


def test_refund_imports_and_marks():
    m = map_commercial_status("已退款")
    assert m.status == OrderCommercialStatus.refunded and m.should_import is True


def test_partial_refund():
    assert map_commercial_status("部分退款").status == OrderCommercialStatus.partial_refund


def test_keyword_fallback_for_unseen_variant():
    m = map_commercial_status("卖家部分发货中")  # unseen, contains 发货
    assert m.status == OrderCommercialStatus.shipped and m.should_import is True


def test_unknown_defaults_paid_and_flagged():
    m = map_commercial_status("某种没见过的怪状态xyz")
    assert m.status == OrderCommercialStatus.paid
    assert m.should_import is True and m.unknown is True


def test_blank_is_flagged_unknown():
    assert map_commercial_status("").unknown is True


# --- create_imported_order persists the new columns -------------------------


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


def _payload():
    return OrderCreate(
        order_date=date(2026, 6, 1),
        external_order_no="EC-1",
        payer_name="王某某",
        total_amount=Decimal("199"),
        paid_amount=Decimal("199"),
        items=[
            OrderItemIn(
                publication=Publication.cbj,
                publication_format=PublicationFormat.paper,
                fulfillment_type=FulfillmentType.single_issue,
                issue_number=2670,
                total_quantity=1,
                unit_price=Decimal("199"),
                subtotal=Decimal("199"),
                targets=[
                    FulfillmentTargetIn(
                        recipient_name="王某某", recipient_address="某地址", quantity=1
                    )
                ],
            )
        ],
    )


def test_create_imported_order_sets_commercial_status_and_archive(db):
    order = order_service.create_imported_order(
        db,
        _payload(),
        order_code="ORD-2026-000009",
        commercial_status=OrderCommercialStatus.refunded,
        source_status_raw="已退款",
        is_historical_archive=True,
    )
    db.commit()
    db.refresh(order)
    assert order.entry_method == OrderEntryMethod.excel_import
    assert order.commercial_status == OrderCommercialStatus.refunded
    assert order.source_status_raw == "已退款"
    assert order.is_historical_archive is True


def test_create_imported_order_defaults_archive_false(db):
    order = order_service.create_imported_order(
        db, _payload(), order_code="ORD-2026-000010"
    )
    db.commit()
    db.refresh(order)
    assert order.is_historical_archive is False
    assert order.commercial_status is None
