import os
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("MYSQL_USER", "test")
os.environ.setdefault("MYSQL_PASSWORD", "test")
os.environ.setdefault("MYSQL_DATABASE", "test")

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    BillingType,
    DeliveryMethod,
    FulfillmentAllocation,
    FulfillmentTarget,
    FulfillmentType,
    Issue,
    IssueStatus,
    Order,
    OrderEvent,
    OrderEventType,
    OrderItem,
    OrderSourceType,
    OrderStatus,
    Publication,
    PublicationFormat,
    PublicationSchedule,
    ShippingChannel,
    ShippingDetail,
    ShippingDetailSourceType,
    ShippingDetailSyncStatus,
    SubscriptionTerm,
)
from app.services.order_shipping_sync_service import (
    apply_order_shipping_sync,
    preview_order_shipping_sync,
)


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


def seed_issue(db, issue_number=2655, publish_date=date(2026, 6, 1), is_suspended=False):
    issue = Issue(
        issue_number=issue_number,
        publish_date=publish_date,
        status=IssueStatus.draft,
    )
    schedule = PublicationSchedule(
        year=publish_date.year,
        issue_number=None if is_suspended else issue_number,
        publish_date=publish_date,
        is_suspended=is_suspended,
    )
    db.add_all([issue, schedule])
    db.commit()
    return issue


def seed_active_subscription_order(
    db,
    *,
    issue_from=2650,
    issue_until=None,
    channel=ShippingChannel.zto_outsource,
):
    order = Order(
        order_code="ORD-2026-000001",
        order_date=date(2026, 1, 1),
        source_type=OrderSourceType.ecommerce,
        payer_name="吴娟",
        payer_contact="13800000000",
        status=OrderStatus.active,
        source_platform="微信小程序",
        source_store="CBJ+",
        total_amount=195,
        paid_amount=195,
    )
    db.add(order)
    db.flush()
    item = OrderItem(
        order_id=order.id,
        publication=Publication.cbj,
        publication_format=PublicationFormat.paper,
        fulfillment_type=FulfillmentType.subscription,
        billing_type=BillingType.paid,
        subscription_term=SubscriptionTerm.half_year,
        delivery_method=DeliveryMethod.zto_mf,
        term_start_month="2026-01",
        coverage_start_date=date(2026, 1, 5),
        coverage_end_date=date(2026, 6, 29),
        total_quantity=1,
        unit_price=195,
        subtotal=195,
    )
    db.add(item)
    db.flush()
    allocation = FulfillmentAllocation(
        order_item_id=item.id,
        version_no=1,
        effective_from_issue=issue_from,
        effective_until_issue=issue_until,
    )
    db.add(allocation)
    db.flush()
    target = FulfillmentTarget(
        order_item_id=item.id,
        allocation_id=allocation.id,
        recipient_name="张三",
        recipient_phone="13900000000",
        recipient_address="北京市朝阳区测试路 1 号",
        quantity=1,
        shipping_channel=channel,
    )
    db.add(target)
    db.commit()
    return order, item, allocation, target


def test_preview_creates_candidate_for_active_subscription_order(db):
    seed_issue(db)
    order, item, _, target = seed_active_subscription_order(db)

    preview = preview_order_shipping_sync(db, order.id, 2655)

    assert preview.summary.candidates == 1
    assert preview.summary.to_create == 1
    assert preview.summary.conflicts == 0
    row = preview.items[0]
    assert row.action == "create"
    assert row.order_id == order.id
    assert row.order_item_id == item.id
    assert row.fulfillment_target_id == target.id
    assert row.name == "张三"
    assert row.quantity == 1


def test_apply_creates_shipping_detail_and_order_event(db):
    seed_issue(db)
    order, item, _, target = seed_active_subscription_order(db)

    result = apply_order_shipping_sync(db, order.id, 2655, operator_id=7)

    assert result.summary.to_create == 0
    assert result.summary.skipped == 1
    detail = db.query(ShippingDetail).one()
    assert detail.issue_number == 2655
    assert detail.name == "张三"
    assert detail.order_id == order.id
    assert detail.order_item_id == item.id
    assert detail.fulfillment_target_id == target.id
    assert detail.source_type == ShippingDetailSourceType.order_generated
    assert detail.sync_status == ShippingDetailSyncStatus.synced
    event = db.query(OrderEvent).filter(OrderEvent.event_type == OrderEventType.synced_to_shipping).one()
    assert event.operator_id == 7
    assert event.payload_json["issue_number"] == 2655
    assert event.payload_json["created_count"] == 1


def test_apply_is_idempotent_and_updates_linked_synced_row(db):
    seed_issue(db)
    order, _, _, _ = seed_active_subscription_order(db)
    apply_order_shipping_sync(db, order.id, 2655, operator_id=7)
    db.query(FulfillmentTarget).one().recipient_phone = "13911111111"
    db.commit()

    result = apply_order_shipping_sync(db, order.id, 2655, operator_id=7)

    assert result.summary.to_update == 0
    assert result.summary.skipped == 1
    assert db.query(ShippingDetail).count() == 1
    assert db.query(ShippingDetail).one().phone == "13911111111"
    event = (
        db.query(OrderEvent)
        .filter(OrderEvent.event_type == OrderEventType.synced_to_shipping)
        .order_by(OrderEvent.id.desc())
        .first()
    )
    assert event.payload_json["updated_count"] == 1


def test_manually_modified_order_generated_row_blocks_apply(db):
    seed_issue(db)
    order, _, _, _ = seed_active_subscription_order(db)
    apply_order_shipping_sync(db, order.id, 2655, operator_id=7)
    detail = db.query(ShippingDetail).one()
    detail.sync_status = ShippingDetailSyncStatus.manually_modified
    detail.phone = "manual"
    db.commit()

    preview = preview_order_shipping_sync(db, order.id, 2655)
    assert preview.summary.conflicts == 1
    assert preview.items[0].action == "conflict"

    with pytest.raises(HTTPException) as ctx:
        apply_order_shipping_sync(db, order.id, 2655, operator_id=7)
    assert ctx.value.status_code == 409


def test_suspended_issue_returns_empty_preview(db):
    seed_issue(db, is_suspended=True)
    order, _, _, _ = seed_active_subscription_order(db)

    preview = preview_order_shipping_sync(db, order.id, 2655)

    assert preview.summary.candidates == 0
    assert preview.summary.to_create == 0
    assert preview.message == "目标期号为休刊期，不生成发货明细"


def test_non_zto_target_is_skipped(db):
    seed_issue(db)
    order, _, _, _ = seed_active_subscription_order(db, channel=ShippingChannel.post_office)

    preview = preview_order_shipping_sync(db, order.id, 2655)

    assert preview.summary.candidates == 0
    assert preview.summary.skipped == 1
    assert preview.items[0].action == "skip"
