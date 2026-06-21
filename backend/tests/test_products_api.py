"""Integration tests for the product catalog (商品库) REST API + seed.

In-memory SQLite + FastAPI TestClient with auth overridden, mirroring
test_orders_api.py.
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
from app.models import Product
from app.models.order_item import Publication
from app.models.user import User, UserRole
from app.seeds.products import seed_products


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


def _simple_product(**over):
    payload = {
        "code": "P1",
        "display_name": "《中国经营报》全年订阅",
        "publication": "cbj",
        "fulfillment_type": "subscription",
        "subscription_term": "one_year",
        "delivery_method": "post_office",
        "coverage_rule": "term_from_month",
        "list_price": "199",
        "aliases": ["618促销活动"],
    }
    payload.update(over)
    return payload


def test_create_and_get_product(client):
    r = client.post("/api/products", json=_simple_product())
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["code"] == "P1"
    assert body["publication"] == "cbj"
    assert body["aliases"] == ["618促销活动"]
    pid = body["id"]

    r2 = client.get(f"/api/products/{pid}")
    assert r2.status_code == 200
    assert r2.json()["display_name"] == "《中国经营报》全年订阅"


def test_duplicate_code_rejected(client):
    assert client.post("/api/products", json=_simple_product()).status_code == 201
    dup = client.post("/api/products", json=_simple_product(display_name="另一个"))
    assert dup.status_code == 409


def test_list_filters_by_active_and_query(client):
    client.post("/api/products", json=_simple_product(code="A", display_name="全年订阅"))
    client.post("/api/products", json=_simple_product(code="B", display_name="最新一期"))
    # deactivate B
    bid = client.get("/api/products").json()
    bid = next(p["id"] for p in bid if p["code"] == "B")
    client.post(f"/api/products/{bid}/deactivate")

    active_only = client.get("/api/products", params={"active": "true"}).json()
    assert {p["code"] for p in active_only} == {"A"}

    by_q = client.get("/api/products", params={"q": "最新"}).json()
    assert {p["code"] for p in by_q} == {"B"}


def test_update_product(client):
    pid = client.post("/api/products", json=_simple_product()).json()["id"]
    r = client.put(f"/api/products/{pid}", json={"list_price": "240", "notes": "调价"})
    assert r.status_code == 200
    assert r.json()["list_price"] == "240.00"
    assert r.json()["notes"] == "调价"


def test_create_bundle_with_components(client):
    bundle = {
        "code": "BUNDLE",
        "display_name": "《中国经营报》和《商学院》全年订阅（8折优惠）",
        "fulfillment_type": "subscription",
        "subscription_term": "one_year",
        "is_bundle": True,
        "list_price": "576",
        "components": [
            {"publication": "cbj", "fixed_price": "240"},
            {"publication": "business_school", "remainder": True},
        ],
    }
    r = client.post("/api/products", json=bundle)
    assert r.status_code == 201, r.text
    comps = r.json()["components"]
    assert len(comps) == 2
    assert comps[1]["remainder"] is True


def test_bundle_without_components_rejected(client):
    r = client.post(
        "/api/products",
        json={
            "code": "BADBUNDLE",
            "display_name": "套餐缺组件",
            "fulfillment_type": "subscription",
            "is_bundle": True,
        },
    )
    assert r.status_code == 422  # schema validation: bundle needs components


def test_non_bundle_without_publication_rejected(client):
    r = client.post(
        "/api/products",
        json={
            "code": "NOPUB",
            "display_name": "缺刊物",
            "fulfillment_type": "subscription",
        },
    )
    assert r.status_code == 422  # non-bundle must specify publication


# ---------------------------------------------------------------------------
# seed
# ---------------------------------------------------------------------------


def test_seed_products_creates_catalog_then_idempotent():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(bind=engine)()
    try:
        assert seed_products(db) == 9
        assert db.query(Product).count() == 9
        bundle = db.query(Product).filter(Product.code == "CBJ-BS-BUNDLE-1Y").one()
        assert bundle.is_bundle is True
        assert bundle.publication is None
        assert bundle.components[0]["fixed_price"] == 240
        # standalone 商学院 annual exists as its own (non-bundle) product so a lone
        # 商学院 line resolves to a single item instead of substring-matching the bundle
        bs = db.query(Product).filter(Product.code == "BS-SUB-1Y").one()
        assert bs.is_bundle is False
        assert bs.publication == Publication.business_school
        # the standard 全年/半年 × 邮局/中通 subscription variants + back-issue retail
        for code in ("CBJ-SUB-1Y-POST", "CBJ-SUB-1Y-ZTO", "CBJ-SUB-6M-POST",
                     "CBJ-SUB-6M-ZTO", "CBJ-BACKISSUE"):
            assert db.query(Product).filter(Product.code == code).count() == 1
        # idempotent: second run inserts nothing
        assert seed_products(db) == 0
        assert db.query(Product).count() == 9
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)
