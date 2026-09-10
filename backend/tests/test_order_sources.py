"""来源交易闭环使用合成订单，禁止真实收件数据进入测试。"""
import io
from datetime import date
from decimal import Decimal
import importlib.util
from pathlib import Path

import pytest
from fastapi import HTTPException
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from sqlalchemy import inspect, MetaData, Table, Column, Integer
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.database import Base
from app.models import Order
from app.models.order_source import OrderSource, OrderSourceVersion
from app.services.cbj_order_import_service import BatchSettings, commit_import, preview_import


@pytest.fixture
def db():
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def workbook(status="卖家已发货", amount=141, external="SYNTHETIC-FEE"):
    wb = Workbook()
    ws = wb.active
    ws.title = "合成订单"
    ws.append(["订单号", "产品名称", "付款金额", "地址", "订单状态", "下单时间", "备注"])
    ws.append([external, f"《中国经营报》运费补拍（邮局转中通）X47,单价:3.0", amount,
               "合成订户,00000000000,合成路1号", status, "2026-09-01 12:00:00", "合成来源备注"])
    output = io.BytesIO()
    wb.save(output)
    return output.getvalue()


@pytest.mark.parametrize("status", ["卖家已发货", "卖家已退款"])
def test_fee_import_is_durable_without_a_subscription(db, status):
    preview, sid = preview_import(db, workbook(status), BatchSettings(mode="historical"), filename="synthetic.xlsx")
    assert preview["rows"][0]["decision"] == "retain"
    assert preview["can_commit"] is True
    assert db.query(OrderSource).count() == 0
    result = commit_import(db, sid)
    assert result["created"] == 0
    assert result["retained_sources"] == 1
    source = db.query(OrderSource).one()
    assert source.kind == "shipping_fee"
    version = db.query(OrderSourceVersion).one()
    assert version.snapshot["source_row"] == 2
    assert version.snapshot["source_sheet"] == "合成订单"
    assert version.snapshot["filename"] == "synthetic.xlsx"
    assert version.snapshot["status_raw"] == status
    assert "运费补拍" in version.search_text
    assert db.query(Order).count() == 0


def test_reimport_same_source_is_idempotent_and_changed_source_requires_confirmation(db):
    _, sid = preview_import(db, workbook(), BatchSettings(mode="historical"))
    commit_import(db, sid)
    again, _ = preview_import(db, workbook(), BatchSettings(mode="historical"))
    assert again["rows"][0]["decision"] == "duplicate"
    changed, sid = preview_import(db, workbook("卖家已退款"), BatchSettings(mode="historical"))
    assert changed["rows"][0]["decision"] == "source_update"
    with pytest.raises(HTTPException, match="") as error:
        commit_import(db, sid)
    assert error.value.status_code == 409
    commit_import(db, sid, confirmed_source_updates=["SYNTHETIC-FEE"])
    assert db.query(OrderSource).count() == 1
    assert db.query(OrderSourceVersion).count() == 2
    assert db.query(OrderSource).one().revision == 2


def test_changed_preview_cannot_overwrite_newer_source_revision(db):
    _, sid = preview_import(db, workbook(), BatchSettings(mode="historical"))
    commit_import(db, sid)
    _, first = preview_import(db, workbook("卖家已退款"), BatchSettings(mode="historical"))
    _, second = preview_import(db, workbook("卖家已退款"), BatchSettings(mode="historical"))
    commit_import(db, first, confirmed_source_updates=["SYNTHETIC-FEE"])
    with pytest.raises(HTTPException) as error:
        commit_import(db, second, confirmed_source_updates=["SYNTHETIC-FEE"])
    assert error.value.status_code == 409
    assert db.query(OrderSourceVersion).count() == 2


def test_source_migration_round_trip():
    path = Path(__file__).resolve().parents[1] / "alembic/versions/a7c9e1f3b5d8_order_source_transactions.py"
    spec = importlib.util.spec_from_file_location("source_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    metadata = MetaData()
    for name in ("users", "orders", "order_items", "fulfillment_targets"):
        Table(name, metadata, Column("id", Integer, primary_key=True))
    metadata.create_all(engine)
    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        for model in (OrderSource, OrderSourceVersion):
            actual = {c["name"] for c in inspect(connection).get_columns(model.__tablename__)}
            assert actual == set(model.__table__.columns.keys())
        migration.downgrade()
        assert "order_sources" not in inspect(connection).get_table_names()
        migration.upgrade()
    engine.dispose()


def test_source_api_keeps_old_text_searchable_and_requires_login(db):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.auth import get_current_user
    from app.database import get_db
    from app.models import User, UserRole
    _, sid = preview_import(db, workbook(), BatchSettings(mode="historical"))
    commit_import(db, sid)
    _, sid = preview_import(db, workbook("卖家已退款"), BatchSettings(mode="historical"))
    commit_import(db, sid, confirmed_source_updates=["SYNTHETIC-FEE"])
    user = User(id=1, username="synthetic-viewer", password_hash="unused", role=UserRole.viewer)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        client = TestClient(app)
        result = client.get("/api/order-sources", params={"search": "卖家已发货", "pending": True})
        assert result.status_code == 200
        assert result.json()["total"] == 1
        source_id = result.json()["rows"][0]["id"]
        detail = client.get(f"/api/order-sources/{source_id}").json()
        assert len(detail["versions"]) == 2
        assert detail["snapshot"]["status_raw"] == "卖家已退款"
        assert client.get("/api/order-sources", params={"search": "%"}).json()["total"] == 0
        del app.dependency_overrides[get_current_user]
        assert client.get("/api/order-sources").status_code == 401
    finally:
        app.dependency_overrides.clear()


def subscription(db, external="SYNTHETIC-SUB", start=date(2026, 1, 1), end=date(2026, 12, 31)):
    from app.models import OrderItem, FulfillmentAllocation, FulfillmentTarget, OrderEntryMethod, OrderStatus
    from app.models.order_item import FulfillmentType, DeliveryMethod
    order = Order(order_code=external, external_order_no=external, order_date=start,
                  entry_method=OrderEntryMethod.excel_import, source_platform="CBJ小程序",
                  status=OrderStatus.active, payer_name="合成订户", paid_amount=240, total_amount=240)
    db.add(order)
    db.flush()
    item = OrderItem(order_id=order.id, fulfillment_type=FulfillmentType.subscription,
                     delivery_method=DeliveryMethod.post_office, total_quantity=1,
                     coverage_start_date=start, coverage_end_date=end, subtotal=240, unit_price=240)
    db.add(item)
    db.flush()
    allocation = FulfillmentAllocation(order_item_id=item.id, version_no=1)
    db.add(allocation)
    db.flush()
    target = FulfillmentTarget(order_item_id=item.id, allocation_id=allocation.id,
        recipient_name="合成订户", recipient_phone="00000000000", recipient_address="合成路1号", quantity=1,
        shipping_channel="post_office")
    db.add(target)
    db.commit()
    return order, item, target


def fee_source(db, status="卖家已发货"):
    _, sid = preview_import(db, workbook(status), BatchSettings(mode="historical"))
    commit_import(db, sid)
    return db.query(OrderSource).one()


def link_request(source, rows, amounts=None):
    from app.schemas.order_source import SourceLinkIn
    return SourceLinkIn(version=source.lock_version, reason="人工核对合成收件资料", allocations=[
        dict(order_id=row["order_id"], order_item_id=row["order_item_id"], target_id=row["target_id"],
             expected_target_version=row["expected_target_version"], amount=amounts[i] if amounts else source.paid_amount)
        for i, row in enumerate(rows)])


def test_candidates_prefer_covered_subscription_over_newer_renewal(db):
    from app.services.order_source_service import candidates
    source = fee_source(db)
    original, _, _ = subscription(db)
    subscription(db, "SYNTHETIC-RENEWAL", date(2027, 1, 1), date(2027, 12, 31))
    rows = candidates(db, source.id)["rows"]
    assert rows[0]["order_id"] == original.id
    assert rows[0]["confidence"] == "high"
    assert rows[1]["confidence"] == "possible"
    subscription(db, "SYNTHETIC-SECOND-ACTIVE")
    assert all(row["confidence"] == "possible" for row in candidates(db, source.id)["rows"])


def test_link_split_refunded_source_search_and_unlink_history(db):
    from app.services.order_source_service import candidates, link_source, source_order_ids
    from app.services.search_service import global_search
    from app.models.order_source import OrderSourceLink, OrderSourceEvent
    source = fee_source(db, "卖家已退款")
    first, _, _ = subscription(db)
    second, _, _ = subscription(db, "SYNTHETIC-SECOND")
    rows = candidates(db, source.id)["rows"]
    with pytest.raises(HTTPException) as error:
        link_source(db, source.id, link_request(source, rows, [70, 70]), None)
    assert error.value.status_code == 422
    assert db.query(OrderSourceLink).count() == 0
    request = link_request(source, rows, [70, 71])
    link_source(db, source.id, request, None)
    db.commit()
    assert {o.id for o in db.query(Order).filter(Order.id.in_(source_order_ids("SYNTHETIC-FEE")))} == {first.id, second.id}
    assert len([hit for hit in global_search(db, "SYNTHETIC-FEE") if hit["type"] == "order"]) == 2
    assert first.paid_amount == second.paid_amount == 240
    assert first.commercial_status is None  # 补运费退款不得传染主订阅。
    with pytest.raises(HTTPException) as error:
        link_source(db, source.id, request, None)
    assert error.value.status_code == 409
    unlink = link_request(source, [])
    link_source(db, source.id, unlink, None)
    db.commit()
    assert db.query(OrderSourceLink).filter_by(active=1).count() == 0
    assert db.query(OrderSourceLink).count() == 2
    assert db.query(OrderSourceEvent).filter_by(action="unlinked").count() == 1
    assert any(hit["type"] == "order_source" for hit in global_search(db, "SYNTHETIC-FEE"))


def test_link_rechecks_target_changes_and_foreign_scope(db):
    from app.services.order_source_service import candidates, link_source
    from app.models.order_source import OrderSourceLink
    source = fee_source(db)
    _, _, target = subscription(db)
    rows = candidates(db, source.id)["rows"]
    request = link_request(source, rows)
    target.recipient_address = "合成新地址2号"
    db.commit()
    with pytest.raises(HTTPException) as error:
        link_source(db, source.id, request, None)
    assert error.value.status_code == 409
    rows = candidates(db, source.id)["rows"]
    assert rows[0]["confidence"] == "possible"
    request = link_request(source, rows)
    request.allocations[0].order_id = 99999
    with pytest.raises(HTTPException) as error:
        link_source(db, source.id, request, None)
    assert error.value.status_code == 422
    assert db.query(OrderSourceLink).count() == 0


def test_link_api_permissions_preview_and_historical_search(db):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.auth import get_current_user
    from app.database import get_db
    from app.models import User, UserRole
    from app.services.order_source_service import candidates
    from app.services.order_service import list_orders
    from app.models.order_source import OrderSourceLink
    source = fee_source(db)
    order, _, _ = subscription(db)
    _, sid = preview_import(db, workbook("卖家已退款"), BatchSettings(mode="historical"))
    commit_import(db, sid, confirmed_source_updates=["SYNTHETIC-FEE"])
    user = User(username="synthetic-admin", password_hash="unused", role=UserRole.viewer)
    db.add(user)
    db.commit()
    body = link_request(source, candidates(db, source.id)["rows"]).model_dump(mode="json")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        client = TestClient(app)
        url = f"/api/order-sources/{source.id}"
        assert client.put(url + "/links", json=body).status_code == 403
        user.role = UserRole.admin
        db.commit()
        assert client.post(url + "/link-preview", json=body).status_code == 200
        assert db.query(OrderSourceLink).count() == 0
        assert client.put(url + "/links", json=body).status_code == 200
        assert client.put(url + "/links", json=body).status_code == 409
        # 旧版本平台状态已变，仍可查到业务主单，分页总数正确。
        result = client.get("/api/orders", params={"search": "卖家已发货", "limit": 1})
        assert result.status_code == 200
        assert result.json()["total"] == 1
        assert result.json()["rows"][0]["id"] == order.id
        assert result.json()["rows"][0]["source_count"] == 1
    finally:
        app.dependency_overrides.clear()


def test_inactive_order_is_not_linkable_even_with_fresh_signature(db):
    from app.models import OrderStatus
    from app.services.order_source_service import candidates, link_source, target_version
    source = fee_source(db)
    order, item, target = subscription(db)
    body = link_request(source, candidates(db, source.id)["rows"])
    order.status = OrderStatus.void
    db.commit()
    body.allocations[0].expected_target_version = target_version(order, item, target)
    with pytest.raises(HTTPException) as error:
        link_source(db, source.id, body, None)
    assert error.value.status_code == 409
