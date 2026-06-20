"""Tests for order_service.create_imported_order (Phase 2 import-create path).

Real in-memory SQLite so provenance, import hooks, the ``imported`` event, the
v1 allocation, confirm-on-commit semantics, and the no-commit / no-package-price
behaviours are verified against actual SQL.
"""

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    FulfillmentAllocation,
    FulfillmentTarget,
    Order,
    OrderEntryMethod,
    OrderEvent,
    OrderEventType,
    OrderItem,
    OrderStatus,
)
from app.models.order_item import (
    DeliveryMethod,
    FulfillmentType,
    Publication,
    PublicationFormat,
    SubscriptionTerm,
)
from app.schemas.order import FulfillmentTargetIn, OrderCreate, OrderItemIn
from app.services import order_service


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


def _single_issue_payload():
    return OrderCreate(
        order_date=date(2026, 6, 1),
        entry_method=OrderEntryMethod.manual,  # client value — must be ignored
        external_order_no="2026060113371095543144",
        source_platform="CBJ小程序",
        payer_name="冯志强",
        payer_contact="15103569527",
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
                        recipient_name="冯志强",
                        recipient_phone="15103569527",
                        recipient_address="晋城市城区西上庄办事处北闫庄星湖湾3#804",
                        quantity=1,
                    )
                ],
            )
        ],
    )


def test_create_imported_order_sets_provenance_hooks_and_event(db):
    order = order_service.create_imported_order(
        db,
        _single_issue_payload(),
        order_code="ORD-2026-000001",
        import_batch_id=7,
        import_row_no=3,
        import_source_sheet="20260620104919",
        operator_id=42,
    )
    db.commit()  # service intentionally does NOT commit; caller does
    db.refresh(order)

    # Provenance forced regardless of the client-supplied entry_method.
    assert order.entry_method == OrderEntryMethod.excel_import
    assert order.status == OrderStatus.active
    assert order.order_code == "ORD-2026-000001"
    assert order.import_batch_id == 7
    assert order.import_row_no == 3
    assert order.import_source_sheet == "20260620104919"
    # Actual paid price carried through.
    assert order.total_amount == Decimal("199")

    # 'imported' audit event with provenance payload.
    events = db.query(OrderEvent).filter(OrderEvent.order_id == order.id).all()
    assert [e.event_type for e in events] == [OrderEventType.imported]
    payload = events[0].payload_json
    assert payload["entry_method"] == "excel_import"
    assert payload["external_order_no"] == "2026060113371095543144"
    assert payload["import_row_no"] == 3

    # v1 allocation + target + expected_issues snapshot (single_issue → 1).
    item = db.query(OrderItem).filter(OrderItem.order_id == order.id).one()
    assert item.expected_issues_at_creation == 1
    alloc = (
        db.query(FulfillmentAllocation)
        .filter(FulfillmentAllocation.order_item_id == item.id)
        .one()
    )
    assert alloc.version_no == 1
    assert alloc.effective_from_issue is None
    assert alloc.effective_until_issue is None
    assert alloc.change_reason == "initial"
    tgt = (
        db.query(FulfillmentTarget)
        .filter(FulfillmentTarget.order_item_id == item.id)
        .one()
    )
    assert tgt.recipient_name == "冯志强"


def test_create_imported_order_does_not_commit(db):
    # Batch atomicity: the service must leave commit to the caller, so a
    # rollback before the caller commits discards the order entirely.
    order_service.create_imported_order(
        db, _single_issue_payload(), order_code="ORD-2026-000002"
    )
    db.rollback()
    assert db.query(Order).count() == 0


def test_create_imported_order_keeps_actual_price_no_package_override(db):
    # A standard one_year / post_office subscription would, on the MANUAL path,
    # have its price auto-filled to the package price (240). The import path must
    # keep the actual promo price (199) the customer paid.
    payload = OrderCreate(
        order_date=date(2026, 6, 1),
        external_order_no="EC-PROMO-1",
        payer_name="叶串",
        total_amount=Decimal("199"),
        paid_amount=Decimal("199"),
        items=[
            OrderItemIn(
                publication=Publication.cbj,
                publication_format=PublicationFormat.paper,
                fulfillment_type=FulfillmentType.subscription,
                subscription_term=SubscriptionTerm.one_year,
                delivery_method=DeliveryMethod.post_office,
                term_start_month="2026-07",
                coverage_start_date=date(2026, 7, 1),
                coverage_end_date=date(2027, 6, 30),
                total_quantity=1,
                unit_price=Decimal("199"),
                subtotal=Decimal("199"),
                targets=[],
            )
        ],
    )
    order = order_service.create_imported_order(
        db, payload, order_code="ORD-2026-000003"
    )
    db.commit()

    item = db.query(OrderItem).filter(OrderItem.order_id == order.id).one()
    assert item.unit_price == Decimal("199")  # NOT overridden to 240
    assert item.subtotal == Decimal("199")
    assert item.coverage_start_date == date(2026, 7, 1)
