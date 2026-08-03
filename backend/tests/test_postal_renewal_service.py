"""邮局跨年续投：宋女士同构场景与防重复。"""

from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.database import get_db
from app.auth import get_current_user, require_admin
from app.main import app
from app.models import (
    FulfillmentAllocation,
    FulfillmentTarget,
    Order,
    OrderItem,
    PostalDelivery,
)
from app.models.fulfillment_target import ShippingChannel, TargetStatus
from app.models.order import OrderEntryMethod, OrderStatus
from app.models.order_item import (
    BillingType,
    DeliveryMethod,
    FulfillmentType,
    OrderItemStatus,
    Publication,
    PublicationFormat,
)
from app.models.postal_delivery import PostalDeliverySourceType
from app.services.postal_renewal_service import (
    generate_renewals,
    link_exact_deliveries,
    list_renewals,
)
from app.services.postal_delivery_service import create_delivery, update_delivery


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, autoflush=False)()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def api_client():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    testing_session = sessionmaker(bind=engine, autoflush=False)

    def override_get_db():
        session = testing_session()
        try:
            yield session
        finally:
            session.close()

    fake_user = SimpleNamespace(id=1, role="admin", username="admin")
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = lambda: fake_user
    app.dependency_overrides[require_admin] = lambda: fake_user
    client = TestClient(app)
    try:
        yield client, testing_session
    finally:
        app.dependency_overrides.clear()


def _seed_cross_year_order(db):
    order = Order(
        order_code="ORD-2026-000001",
        external_order_no="2026071622202732603212",
        order_date=date(2026, 7, 20),
        entry_method=OrderEntryMethod.manual,
        source_platform="微信小程序",
        source_store="CBJ+",
        payer_name="宋女士",
        total_amount=Decimal("240"),
        paid_amount=Decimal("240"),
        status=OrderStatus.active,
    )
    db.add(order)
    db.flush()
    item = OrderItem(
        order_id=order.id,
        publication=Publication.cbj,
        publication_format=PublicationFormat.paper,
        fulfillment_type=FulfillmentType.subscription,
        billing_type=BillingType.paid,
        delivery_method=DeliveryMethod.post_office,
        coverage_start_date=date(2026, 8, 3),
        coverage_end_date=date(2027, 7, 26),
        total_quantity=1,
        unit_price=Decimal("240"),
        subtotal=Decimal("240"),
        status=OrderItemStatus.active,
    )
    db.add(item)
    db.flush()
    allocation = FulfillmentAllocation(order_item_id=item.id, version_no=1)
    db.add(allocation)
    db.flush()
    # 保留历史数据中的默认快递渠道，证明续投以订单明细的邮局投递方式为准。
    target = FulfillmentTarget(
        order_item_id=item.id,
        allocation_id=allocation.id,
        recipient_name="宋女士",
        recipient_phone="13256785090",
        recipient_address="山东省济南市历下区姚家街道华润置地广场南区6区3号楼29层",
        recipient_postal_code="250014",
        quantity=1,
        shipping_channel=ShippingChannel.zto_outsource,
        status=TargetStatus.active,
    )
    db.add(target)
    db.flush()
    delivery = PostalDelivery(
        year=2026,
        delivery_no="6352",
        external_order_no=order.external_order_no,
        source_type=PostalDeliverySourceType.historical_import,
        recipient_name="宋女士",
        recipient_phone="13256785090",
        recipient_address=target.recipient_address,
        recipient_postal_code="250014",
        product="中国经营报",
        copies=1,
        amount=Decimal("100"),
        coverage_start_date=date(2026, 8, 1),
        coverage_end_date=date(2026, 12, 31),
        source_channel="CBJ+小程序",
    )
    db.add(delivery)
    db.commit()
    return order, item, target, delivery


def test_cross_year_gap_links_and_generates_remaining_segment(db):
    order, item, target, old_delivery = _seed_cross_year_order(db)

    pending = list_renewals(db, "2027-01")
    assert pending["summary"] == {
        "candidate_count": 1,
        "pending_order_count": 1,
        "pending_detail_count": 1,
        "pending_copies": 1,
        "covered_count": 0,
        "needs_link_count": 0,
    }
    row = pending["rows"][0]
    assert row["previous_delivery_no"] == "2026-6352"
    assert row["proposed_start_date"] == date(2027, 1, 1)
    assert row["proposed_end_date"] == date(2027, 7, 31)
    assert row["proposed_amount"] == Decimal("140.00")

    linked = link_exact_deliveries(db)
    db.refresh(old_delivery)
    assert linked == {"linked": 1, "unresolved": 0, "examined": 1}
    assert (old_delivery.order_id, old_delivery.order_item_id, old_delivery.fulfillment_target_id) == (
        order.id,
        item.id,
        target.id,
    )

    result = generate_renewals(
        db,
        target_month="2027-01",
        fulfillment_target_ids=[target.id],
        operator_id=None,
    )
    assert result["created_count"] == 1
    new_delivery = result["created"][0]
    assert new_delivery.source_type == PostalDeliverySourceType.order_generated
    assert new_delivery.coverage_start_date == date(2027, 1, 1)
    assert new_delivery.coverage_end_date == date(2027, 7, 31)
    assert new_delivery.amount == Decimal("140.00")
    assert new_delivery.fulfillment_target_id == target.id

    after = list_renewals(db, "2027-01")
    assert after["rows"] == []
    assert after["summary"]["covered_count"] == 1
    assert after["summary"]["pending_detail_count"] == 0

    duplicate = generate_renewals(
        db,
        target_month="2027-01",
        fulfillment_target_ids=[target.id],
    )
    assert duplicate["created_count"] == 0
    assert duplicate["skipped_count"] == 1


def test_non_post_office_item_is_not_a_renewal_candidate(db):
    _, item, _, _ = _seed_cross_year_order(db)
    item.delivery_method = DeliveryMethod.zto_mf
    db.commit()

    result = list_renewals(db, "2027-01")

    assert result["summary"]["candidate_count"] == 0
    assert result["rows"] == []


def test_delivery_save_automatically_links_exact_order(db):
    order, item, target, old_delivery = _seed_cross_year_order(db)
    db.delete(old_delivery)
    db.commit()

    delivery = create_delivery(db, {
        "year": 2026,
        "delivery_no": "6352",
        "external_order_no": order.external_order_no,
        "recipient_name": "宋女士",
        "recipient_phone": "13256785090",
        "recipient_address": target.recipient_address,
        "copies": 1,
    })

    assert (delivery.order_id, delivery.order_item_id, delivery.fulfillment_target_id) == (
        order.id,
        item.id,
        target.id,
    )


def test_editing_source_number_replaces_stale_link(db):
    order, item, target, delivery = _seed_cross_year_order(db)
    delivery.order_id = 999
    delivery.order_item_id = 999
    delivery.fulfillment_target_id = 999
    db.commit()

    updated = update_delivery(db, delivery.id, {
        "external_order_no": order.external_order_no,
    })

    assert (updated.order_id, updated.order_item_id, updated.fulfillment_target_id) == (
        order.id,
        item.id,
        target.id,
    )


def test_renewal_http_flow(api_client):
    client, testing_session = api_client
    session = testing_session()
    _, _, target, _ = _seed_cross_year_order(session)
    target_id = target.id
    session.close()

    pending = client.get("/api/postal/renewals", params={"target_month": "2027-01"})
    assert pending.status_code == 200, pending.text
    assert pending.json()["rows"][0]["proposed_amount"] == "140.00"

    linked = client.post("/api/postal/deliveries/link-exact")
    assert linked.status_code == 200, linked.text
    assert linked.json()["linked"] == 1

    generated = client.post("/api/postal/renewals/generate", json={
        "target_month": "2027-01",
        "fulfillment_target_ids": [target_id],
    })
    assert generated.status_code == 200, generated.text
    body = generated.json()
    assert body["created_count"] == 1
    assert body["created"][0]["order_code"] == "ORD-2026-000001"
    assert body["created"][0]["coverage_end_date"] == "2027-07-31"

    after = client.get("/api/postal/renewals", params={"target_month": "2027-01"}).json()
    assert after["summary"]["pending_detail_count"] == 0
    assert after["summary"]["covered_count"] == 1


def test_order_created_after_delivery_backfills_link(api_client):
    client, _ = api_client
    external = "LATE-ORDER-001"
    delivery_response = client.post("/api/postal/deliveries", json={
        "year": 2026,
        "delivery_no": "7001",
        "external_order_no": external,
        "recipient_name": "后建订单读者",
        "recipient_phone": "13800000001",
        "recipient_address": "北京市朝阳区测试地址",
    })
    assert delivery_response.status_code == 201, delivery_response.text
    delivery = delivery_response.json()
    assert delivery["order_id"] is None
    assert delivery["link_status"] == "order_not_found"
    retry = client.post(f"/api/postal/deliveries/{delivery['id']}/link-exact")
    assert retry.status_code == 200, retry.text
    assert retry.json()["link_status"] == "order_not_found"

    order_response = client.post("/api/orders", json={
        "order_date": "2026-08-01",
        "entry_method": "manual",
        "source_platform": "CBJ+小程序",
        "external_order_no": external,
        "payer_name": "后建订单读者",
        "total_amount": "240",
        "paid_amount": "240",
        "items": [{
            "publication": "cbj",
            "publication_format": "paper",
            "fulfillment_type": "subscription",
            "billing_type": "paid",
            "delivery_method": "post_office",
            "coverage_start_date": "2026-08-01",
            "coverage_end_date": "2027-07-31",
            "total_quantity": 1,
            "unit_price": "240",
            "subtotal": "240",
            "targets": [{
                "recipient_name": "后建订单读者",
                "recipient_phone": "13800000001",
                "recipient_address": "北京市朝阳区测试地址",
                "quantity": 1,
                "shipping_channel": "post_office",
            }],
        }],
    })
    assert order_response.status_code == 201, order_response.text
    order = order_response.json()

    linked = client.get(f"/api/postal/deliveries/{delivery['id']}")
    assert linked.status_code == 200, linked.text
    assert linked.json()["order_id"] == order["id"]
    assert linked.json()["link_status"] == "linked"
