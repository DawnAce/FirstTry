"""缺少来源交易迁移时，导入应返回可操作提示且不写入订单。"""
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import OperationalError, ProgrammingError

from app.api import order_import
from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import Order
from app.models.order_source import OrderSource
from test_order_sources import db, workbook


@pytest.fixture
def client(db):
    app = FastAPI()
    app.include_router(order_import.router)
    user = SimpleNamespace(id=1)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[require_admin] = lambda: user
    return TestClient(app, raise_server_exceptions=False)


@pytest.mark.parametrize("ddl", [
    "DROP TABLE order_sources",
    "ALTER TABLE order_sources DROP COLUMN finance_review_required",
])
def test_preview_missing_source_schema_explains_upgrade_without_writing(client, db, ddl):
    db.execute(text(ddl))
    db.commit()
    response = client.post("/api/order-import/preview", files={"file": ("synthetic.xlsx", workbook())})
    assert response.status_code == 503
    assert "数据库迁移" in response.json()["detail"]
    assert "SYNTHETIC-FEE" not in response.text
    assert "SELECT" not in response.text
    assert db.query(Order).count() == 0


def test_migrated_schema_allows_preview_and_confirm(client, db):
    preview = client.post("/api/order-import/preview", files={"file": ("synthetic.xlsx", workbook())})
    assert preview.status_code == 200
    assert preview.json()["rows"][0]["decision"] == "retain"
    assert db.query(OrderSource).count() == 0
    confirmed = client.post("/api/order-import/commit", json={"session_id": preview.json()["session_id"]})
    assert confirmed.status_code == 200
    assert confirmed.json()["retained_sources"] == 1


@pytest.mark.parametrize("endpoint", ["preview", "commit"])
@pytest.mark.parametrize("error", [
    ProgrammingError("synthetic SQL", {}, Exception(1146, "Table 'synthetic.order_sources' doesn't exist")),
    OperationalError("synthetic SQL", {}, Exception(1054, "Unknown column 'order_sources.finance_review_required' in 'field list'")),
])
def test_mysql_missing_schema_is_translated_for_both_endpoints(client, monkeypatch, endpoint, error):
    def fail(*args, **kwargs):
        raise error
    monkeypatch.setattr(order_import, f"{endpoint}_import", fail)
    response = (client.post("/api/order-import/preview", files={"file": ("synthetic.xlsx", workbook())})
                if endpoint == "preview" else
                client.post("/api/order-import/commit", json={"session_id": "synthetic-session"}))
    assert response.status_code == 503
    assert "数据库迁移" in response.json()["detail"]


@pytest.mark.parametrize("error", [
    OperationalError("SELECT order_sources", {}, Exception(2003, "Cannot connect to MySQL")),
    ProgrammingError("synthetic SQL", {}, Exception(1146, "Table 'synthetic.unrelated_table' doesn't exist")),
])
def test_unrelated_database_failures_are_not_misreported_as_missing_source_schema(client, monkeypatch, error):
    def fail(*args, **kwargs):
        raise error
    monkeypatch.setattr(order_import, "preview_import", fail)
    response = client.post("/api/order-import/preview", files={"file": ("synthetic.xlsx", workbook())})
    assert response.status_code == 500
    assert "数据库迁移" not in response.text
