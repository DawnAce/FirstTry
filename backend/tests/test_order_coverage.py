"""批量补订期：隔离数据库中的预览、原子保存和导入会话往返。"""
from datetime import date, datetime
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import get_current_user
from app.database import Base, get_db
from app.main import app
from app.models import Order, OrderItem, OrderEvent, ShippingDetail
from app.models.fulfillment_allocation import FulfillmentAllocation
from app.models.fulfillment_target import FulfillmentTarget
from app.models.order import OrderEntryMethod, OrderStatus, OrderCommercialStatus
from app.models.order_item import Publication, FulfillmentType, SubscriptionTerm
from app.models.user import User, UserRole
from app.order_import_cache import save_order_import_session, get_order_import_session


@pytest.fixture
def env():
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    user = User(id=1, username="coverage-tester", password_hash="unused", role=UserRole.admin)
    db.add(user)
    order = Order(order_code="ORD-TEST-1", external_order_no="SYNTHETIC-1",
                  order_date=date(2026, 2, 4), entry_method=OrderEntryMethod.excel_import,
                  status=OrderStatus.active, commercial_status=OrderCommercialStatus.shipped,
                  source_platform="CBJ小程序", payer_name="测试收件人", total_amount=199, paid_amount=199)
    order.items = [OrderItem(publication=Publication.cbj, fulfillment_type=FulfillmentType.subscription,
                            subscription_term=SubscriptionTerm.one_year, total_quantity=1,
                            unit_price=199, subtotal=199),
                   OrderItem(publication=Publication.business_school, fulfillment_type=FulfillmentType.subscription,
                             subscription_term=SubscriptionTerm.custom, total_quantity=1,
                             unit_price=0, subtotal=0)]
    db.add(order)
    db.commit()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(app)  # 不运行生产连接池 startup。
    try:
        yield client, db, order, user
    finally:
        app.dependency_overrides.clear()
        db.close()
        engine.dispose()


def candidates(client, **params):
    response = client.get("/api/order-coverage/candidates", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def preview(client, rows, **kwargs):
    changes = [dict(key=r["key"], expected_version=r["version"],
                    coverage_start_date="2026-03-01", coverage_end_date="2027-02-28") for r in rows]
    response = client.post("/api/order-coverage/preview", json={"changes": changes, "reason": "补录原订期", **kwargs})
    assert response.status_code == 200, response.text
    return response.json()


def test_candidates_pagination_and_filters(env):
    client, db, order, _ = env
    result = candidates(client, limit=1)
    assert result["total"] == 2 and result["order_count"] == 1
    assert len(result["rows"]) == 1
    assert candidates(client, publication="business_school")["rows"][0]["subscription_term"] == "custom"
    assert candidates(client, source_platform="淘宝")["total"] == 0
    assert candidates(client, order_date_start="2026-03-01")["total"] == 0
    order.items[0].coverage_start_date = date(2026, 1, 1)
    order.items[0].coverage_end_date = date(2026, 12, 31)
    db.commit()
    assert candidates(client)["total"] == 1
    assert candidates(client, missing_only=False)["total"] == 2


def test_preview_apply_preserves_prices_and_audits_and_is_idempotent(env):
    client, db, order, _ = env
    item = order.items[0]
    allocation = FulfillmentAllocation(order_item_id=item.id, version_no=1)
    db.add(allocation)
    db.flush()
    target = FulfillmentTarget(order_item_id=item.id, allocation_id=allocation.id,
                               recipient_name="测试收报人", recipient_address="合成测试地址", quantity=1)
    shipping = ShippingDetail(issue_number=2639, sheet_name="中通", channel="测试", name="测试收报人",
                              quantity=1, shipped_at=datetime(2026, 2, 1), order_id=order.id, order_item_id=item.id)
    db.add_all([target, shipping])
    db.commit()
    rows = candidates(client)["rows"]
    plan = preview(client, rows)
    assert plan["can_apply"] and plan["order_count"] == 1
    assert order.items[0].coverage_start_date is None
    response = client.post("/api/order-coverage/apply", json={"preview_id": plan["preview_id"]})
    assert response.status_code == 200, response.text
    assert response.json()["updated"] == 2
    db.refresh(order.items[0])
    assert order.items[0].coverage_start_date == date(2026, 3, 1)
    assert order.items[0].coverage_end_date == date(2027, 2, 28)
    assert order.items[0].unit_price == Decimal("199")
    assert order.paid_amount == Decimal("199")
    assert order.items[0].expected_issues_at_creation is None
    db.refresh(allocation)
    db.refresh(shipping)
    assert allocation.version_no == 1 and allocation.effective_until_issue is None
    assert shipping.shipped_at == datetime(2026, 2, 1) and shipping.quantity == 1
    assert db.query(FulfillmentAllocation).count() == 1
    assert db.query(OrderEvent).count() == 2
    assert client.post("/api/order-coverage/apply", json={"preview_id": plan["preview_id"]}).status_code == 200
    assert db.query(OrderEvent).count() == 2
    assert candidates(client)["total"] == 0


def test_successful_partial_fill_different_bundle_dates_and_validation(env):
    client, db, order, _ = env
    order.items[0].coverage_start_date = date(2026, 3, 1)
    db.commit()
    rows = candidates(client)["rows"]
    changes = [dict(key=r["key"], expected_version=r["version"], coverage_start_date="2026-03-01",
                    coverage_end_date="2027-02-28" if r["publication"] == "cbj" else "2026-05-31") for r in rows]
    bad = {**changes[0], "coverage_end_date": "2026-02-28"}
    assert client.post("/api/order-coverage/preview", json={"changes": [bad], "reason": "补录"}).status_code == 422
    assert client.post("/api/order-coverage/preview", json={"changes": [changes[0], changes[0]], "reason": "补录"}).status_code == 422
    assert client.post("/api/order-coverage/preview", json={"changes": [{**changes[0], "unit_price": 240}], "reason": "补录"}).status_code == 422
    plan = client.post("/api/order-coverage/preview", json={"changes": changes, "reason": "双刊原订期"}).json()
    assert plan["can_apply"]
    assert client.post("/api/order-coverage/apply", json={"preview_id": plan["preview_id"]}).status_code == 200
    db.refresh(order.items[1])
    assert order.items[1].coverage_end_date == date(2026, 5, 31)


def test_state_change_and_expired_preview(env, monkeypatch):
    from app.services import order_coverage_service as service
    client, db, order, _ = env
    plan = preview(client, candidates(client)["rows"])
    order.commercial_status = OrderCommercialStatus.refunded
    db.commit()
    assert client.post("/api/order-coverage/apply", json={"preview_id": plan["preview_id"]}).status_code == 409
    assert all(i.coverage_start_date is None for i in order.items)
    monkeypatch.setattr(service, "_TTL", 0)
    assert client.post("/api/order-coverage/apply", json={"preview_id": plan["preview_id"]}).status_code == 400


def test_import_preview_fill_commit_end_to_end(env):
    import io
    from openpyxl import Workbook
    from app.seeds.products import seed_products
    client, db, _, _ = env
    seed_products(db)
    workbook = Workbook()
    workbook.active.append(["订单号", "产品名称", "付款金额", "地址", "订单状态", "下单时间"])
    workbook.active.append(["SYNTHETIC-IMPORT-E2E", "《中国经营报》全年订阅-618促销活动X1,单价:199", 199,
                            "测试收报人,13800000000,合成测试地址", "卖家已发货", "2026-02-01"])
    stream = io.BytesIO()
    workbook.save(stream)
    response = client.post("/api/order-import/preview", files={"file": ("synthetic.xlsx", stream.getvalue())}, data={"mode": "historical"})
    assert response.status_code == 200, response.text
    session_id = response.json()["session_id"]
    rows = candidates(client, import_session_id=session_id)["rows"]
    plan = preview(client, rows, import_session_id=session_id)
    assert client.post("/api/order-coverage/apply", json={"preview_id": plan["preview_id"]}).status_code == 200
    committed = client.post("/api/order-import/commit", json={"session_id": session_id})
    assert committed.status_code == 200, committed.text
    imported = db.query(Order).filter_by(external_order_no="SYNTHETIC-IMPORT-E2E").one()
    assert imported.items[0].coverage_start_date == date(2026, 3, 1)
    assert imported.items[0].coverage_end_date == date(2027, 2, 28)
    assert imported.items[0].unit_price == Decimal("199")
    assert imported.is_historical_archive
    events = db.query(OrderEvent).filter_by(order_id=imported.id).all()
    assert len(events) == 2
    assert events[-1].payload_json["change_reason"] == "补录原订期"


def test_concurrent_change_blocks_entire_batch(env):
    client, db, order, _ = env
    plan = preview(client, candidates(client)["rows"])
    order.items[1].unit_price = 120
    db.commit()
    result = client.post("/api/order-coverage/apply", json={"preview_id": plan["preview_id"]})
    assert result.status_code == 409
    assert all(i.coverage_start_date is None for i in order.items)
    assert db.query(OrderEvent).count() == 0


def test_target_change_blocks_stale_preview(env):
    client, db, order, _ = env
    allocation = FulfillmentAllocation(order_item_id=order.items[0].id, version_no=1)
    db.add(allocation)
    db.flush()
    target = FulfillmentTarget(order_item_id=order.items[0].id, allocation_id=allocation.id,
                               recipient_name="合成订户", recipient_address="合成地址", quantity=1)
    db.add(target)
    db.commit()
    plan = preview(client, candidates(client)["rows"])
    target.effective_until_issue = 2650
    db.commit()
    assert client.post("/api/order-coverage/apply", json={"preview_id": plan["preview_id"]}).status_code == 409
    assert all(item.coverage_start_date is None for item in order.items)


def test_import_session_rejects_other_owner_without_consuming_session(env):
    client, _, _, _ = env
    session_id = save_order_import_session({"owner_id": 999, "mode": "historical", "rows": []})
    assert client.get("/api/order-coverage/candidates", params={"import_session_id": session_id}).status_code == 403
    assert client.post("/api/order-import/commit", json={"session_id": session_id}).status_code == 403
    assert get_order_import_session(session_id) is not None


def test_partial_dates_cannot_be_overwritten_and_refunds_blocked(env):
    client, db, order, _ = env
    order.items[0].coverage_start_date = date(2026, 1, 1)
    db.commit()
    assert not preview(client, candidates(client)["rows"])["can_apply"]
    order.commercial_status = OrderCommercialStatus.refunded
    db.commit()
    assert all(r["blocked_reason"] for r in candidates(client)["rows"])
    assert not preview(client, candidates(client)["rows"])["can_apply"]


def test_validation_permissions_and_preview_ownership(env):
    client, db, order, user = env
    rows = candidates(client)["rows"]
    plan = preview(client, rows)
    user.id = 200  # 仅替换鉴权对象，避免写入数据库。
    assert client.post("/api/order-coverage/apply", json={"preview_id": plan["preview_id"]}).status_code == 403
    db.rollback()
    user.role = UserRole.viewer
    assert client.post("/api/order-coverage/preview", json={"changes": [], "reason": "test"}).status_code == 403


def test_import_changes_stay_in_session_and_preserve_other_fields(env):
    client, db, order, user = env
    payload = {"mode": "historical", "owner_id": user.id, "rows": [{
        "order_create": {"external_order_no": "IMPORT-SYNTHETIC", "order_date": "2026-02-04",
                         "payer_name": "测试收件人", "source_platform": "CBJ小程序", "paid_amount": "199",
                         "items": [{"publication": "cbj", "fulfillment_type": "subscription", "subscription_term": "one_year",
                                    "coverage_start_date": None, "coverage_end_date": None,
                                    "unit_price": "199", "subtotal": "199", "targets": []}]},
        "commercial_status": "shipped", "is_historical_archive": True}]}
    session_id = save_order_import_session(payload)
    rows = candidates(client, import_session_id=session_id)["rows"]
    plan = preview(client, rows, import_session_id=session_id)
    result = client.post("/api/order-coverage/apply", json={"preview_id": plan["preview_id"]})
    assert result.status_code == 200, result.text
    item = get_order_import_session(session_id)["rows"][0]["order_create"]["items"][0]
    assert item["coverage_end_date"] == "2027-02-28" and item["unit_price"] == "199"
    assert db.query(Order).count() == 1 and db.query(OrderEvent).count() == 0
