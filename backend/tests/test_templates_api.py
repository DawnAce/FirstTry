"""Integration tests for 报数模板 (report item templates) REST API,
focused on the drag-and-drop /reorder endpoint.

In-memory SQLite + FastAPI TestClient with auth overridden, mirroring
test_products_api.py.
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("MYSQL_USER", "test")
os.environ.setdefault("MYSQL_PASSWORD", "test")
os.environ.setdefault("MYSQL_DATABASE", "test")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import get_current_user
from app.database import Base, get_db
from app.main import app
from app.models.user import User, UserRole


@pytest.fixture
def client():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    fake_user = User(id=1, username="tester", password_hash="x", role=UserRole.admin)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = lambda: fake_user

    c = TestClient(app)
    try:
        yield c
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)


def _make(client, sub, sort, category="postal"):
    resp = client.post(
        "/api/templates",
        json={
            "category": category,
            "sub_category": sub,
            "display_name": sub,
            "default_value": 100,
            "is_variable": True,
            "sort_order": sort,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_reorder_swaps_sort_order(client):
    a = _make(client, "外埠", 10)
    b = _make(client, "本市", 20)

    resp = client.post(
        "/api/templates/reorder",
        json={"items": [{"id": a["id"], "sort_order": 20}, {"id": b["id"], "sort_order": 10}]},
    )
    assert resp.status_code == 204, resp.text

    rows = {t["id"]: t for t in client.get("/api/templates").json()}
    assert rows[a["id"]]["sort_order"] == 20
    assert rows[b["id"]]["sort_order"] == 10

    # list_templates orders by sort_order → 本市 (now 10) comes first
    ordered = [t["sub_category"] for t in client.get("/api/templates").json()]
    assert ordered == ["本市", "外埠"]


def test_reorder_missing_id_returns_404_without_mutating(client):
    a = _make(client, "外埠", 10)
    resp = client.post(
        "/api/templates/reorder",
        json={"items": [{"id": a["id"], "sort_order": 99}, {"id": 999999, "sort_order": 5}]},
    )
    assert resp.status_code == 404
    # missing id is rejected before any mutation → original sort_order preserved
    rows = client.get("/api/templates").json()
    assert rows[0]["sort_order"] == 10


def test_reorder_empty_is_noop(client):
    _make(client, "外埠", 10)
    resp = client.post("/api/templates/reorder", json={"items": []})
    assert resp.status_code == 204
    assert len(client.get("/api/templates").json()) == 1
