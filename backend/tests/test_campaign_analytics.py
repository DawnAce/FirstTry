"""Integration tests for the per-campaign sales analytics endpoint.

Same strategy as ``test_orders_api.py``: a FastAPI app over in-memory SQLite,
auth bypassed via dependency override. Orders are inserted directly through the
ORM (the aggregation only reads ``orders``, so we don't need the full
create-order payload machinery).

Demonstrates the design point: ``618`` and ``双十一`` — and the same campaign
across two years — stay separable via the ``campaign`` tag, which carries the
year, WITHOUT any year living in a product name.
"""

import os
import sys
from datetime import date
from decimal import Decimal
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
from app.models.order import Order, OrderEntryMethod, OrderStatus
from app.models.user import User, UserRole


def _order(campaign, paid, listed=None, *, status=OrderStatus.active, order_date=date(2026, 6, 1)):
    # listed -> original_amount (原价/折前); None = "no list price captured" (legacy/manual).
    # total_amount tracks the paid amount (import semantics); discount lives in original_amount.
    return Order(
        order_date=order_date,
        entry_method=OrderEntryMethod.excel_import,
        payer_name="X",
        campaign=campaign,
        paid_amount=Decimal(str(paid)),
        total_amount=Decimal(str(paid)),
        original_amount=None if listed is None else Decimal(str(listed)),
        status=status,
    )


@pytest.fixture
def client():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    seed_db = TestingSessionLocal()
    seed_db.add_all(
        [
            _order("2026-618", 199, 240),                            # 原价240 实付199 → 省41
            _order("2026-618", 200, 240),                            # 省40
            _order("2026-618", 240, 240, status=OrderStatus.void),   # void → excluded
            _order("2026-双十一", 240),                              # 原价未抓 → COALESCE实付, 无折扣
            _order("2026-618", 999, 999, status=OrderStatus.draft),  # draft → excluded
            _order(None, 480, 480),                                  # untagged → excluded
            _order("2025-618", 199, 240, order_date=date(2025, 6, 1)),
        ]
    )
    seed_db.commit()
    seed_db.close()

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


def _money(x) -> Decimal:
    # robust to Decimal-as-string or number JSON serialisation
    return Decimal(str(x))


def test_campaign_summary_groups_excludes_void_and_untagged(client):
    resp = client.get("/api/analytics/campaigns")
    assert resp.status_code == 200
    data = resp.json()

    by = {r["campaign"]: r for r in data["rows"]}
    # void + untagged are excluded; 618/双十一/2025-618 are three distinct rows
    assert set(by) == {"2026-618", "2026-双十一", "2025-618"}

    # 618: two non-void orders, ¥199 + ¥200
    assert by["2026-618"]["order_count"] == 2
    assert _money(by["2026-618"]["total_paid"]) == Decimal("399.00")
    # discount depth: 原价 480 (240+240) − 实付 399 = 81
    assert _money(by["2026-618"]["total_listed"]) == Decimal("480.00")
    assert _money(by["2026-618"]["total_discount"]) == Decimal("81.00")

    # 双十一 is NOT merged into 618 — the campaign tag keeps them apart
    assert by["2026-双十一"]["order_count"] == 1
    # no 原价 captured → COALESCE to paid, zero discount (not a phantom negative/zero list)
    assert _money(by["2026-双十一"]["total_listed"]) == Decimal("240.00")
    assert _money(by["2026-双十一"]["total_discount"]) == Decimal("0.00")
    # same campaign name, different YEAR → still a separate row (year is in the tag)
    assert by["2025-618"]["order_count"] == 1

    assert data["total_campaigns"] == 3
    assert data["grand_total_orders"] == 4
    assert _money(data["grand_total_paid"]) == Decimal("838.00")     # 399 + 240 + 199
    assert _money(data["grand_total_listed"]) == Decimal("960.00")   # 480 + 240 + 240
    assert _money(data["grand_total_discount"]) == Decimal("122.00") # 81 + 0 + 41


def test_campaign_summary_date_filter(client):
    resp = client.get("/api/analytics/campaigns", params={"date_from": "2026-01-01"})
    assert resp.status_code == 200
    campaigns = {r["campaign"] for r in resp.json()["rows"]}
    # the 2025 order is filtered out
    assert campaigns == {"2026-618", "2026-双十一"}


def test_campaign_summary_empty(client):
    resp = client.get("/api/analytics/campaigns", params={"date_from": "2030-01-01"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["rows"] == []
    assert data["total_campaigns"] == 0
    assert data["grand_total_orders"] == 0
    assert _money(data["grand_total_paid"]) == Decimal("0.00")
