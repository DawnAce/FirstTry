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
