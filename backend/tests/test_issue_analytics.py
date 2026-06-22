"""Tests for 商学院 monthly-issue identity + per-issue sales analytics (item ②).

Two layers:

* ``normalize_business_school_issue_label`` — title → normalised "YYYY-MM" key.
* ``GET /api/analytics/issues`` — per-issue copies + revenue, grouped on that
  key, proving the year/month lives in the issue layer (queryable) while the
  product catalog stays year-free.
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
from app.models.order_item import FulfillmentType, OrderItem, Publication
from app.models.user import User, UserRole
from app.services.issue_label import normalize_business_school_issue_label


# ---------------------------------------------------------------------------
# normalize_business_school_issue_label
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "title,expected",
    [
        ("2026年1月刊《AI赋能，乡村新生》", "2026-01"),
        ("2026年4月刊《AI硬件：元年已至》", "2026-04"),
        ("2026年2~3月合刊《AI+知识产权，迎接新规则时代》", "2026-02~03"),
        ("2026年12月刊《X》", "2026-12"),
        # not a dated monthly issue → None
        ("《中国经营报》全年订阅（邮局周投）", None),
        ("《中国经营报》最新一期订阅", None),
        ("《商学院》全年订阅", None),
        # dated but NOT a 月刊/合刊 → must not look like an issue
        ("2026年1月新春礼包", None),
        ("《商学院》2026年1月特刊", None),
        ("", None),
        (None, None),
    ],
)
def test_normalize_issue_label(title, expected):
    assert normalize_business_school_issue_label(title) == expected


# ---------------------------------------------------------------------------
# GET /api/analytics/issues
# ---------------------------------------------------------------------------


def _order(db, *, status=OrderStatus.active, order_date=date(2026, 6, 1), items):
    o = Order(
        order_date=order_date,
        entry_method=OrderEntryMethod.excel_import,
        payer_name="X",
        status=status,
    )
    db.add(o)
    db.flush()
    for it in items:
        it.order_id = o.id
        db.add(it)
    return o


def _bs_issue(label, qty, paid):
    return OrderItem(
        publication=Publication.business_school,
        fulfillment_type=FulfillmentType.single_issue,
        issue_label=label,
        total_quantity=qty,
        subtotal=Decimal(str(paid)),
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

    db = TestingSessionLocal()
    # 2026-01: two active lines (qty 1 + 1, ¥40 + ¥40)
    _order(db, items=[_bs_issue("2026-01", 1, 40)])
    _order(db, items=[_bs_issue("2026-01", 1, 40)])
    # 2026-04: one active line, qty 2, ¥80
    _order(db, items=[_bs_issue("2026-04", 2, 80)])
    # void → excluded
    _order(db, status=OrderStatus.void, items=[_bs_issue("2026-01", 1, 40)])
    # subscription (no issue_label) → excluded
    _order(
        db,
        items=[
            OrderItem(
                publication=Publication.business_school,
                fulfillment_type=FulfillmentType.subscription,
                total_quantity=1,
                subtotal=Decimal("480"),
            )
        ],
    )
    # CBJ back-issue keyed by 期号 only (no issue_label) → excluded from this view
    _order(
        db,
        items=[
            OrderItem(
                publication=Publication.cbj,
                fulfillment_type=FulfillmentType.single_issue,
                issue_number=2638,
                total_quantity=1,
                subtotal=Decimal("10"),
            )
        ],
    )
    # draft order with a 商学院 single issue → excluded (only active orders count)
    _order(db, status=OrderStatus.draft, items=[_bs_issue("2026-01", 1, 40)])
    db.commit()
    db.close()

    fake_user = User(id=1, username="tester", password_hash="x", role=UserRole.admin)

    def override_get_db():
        d = TestingSessionLocal()
        try:
            yield d
        finally:
            d.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = lambda: fake_user

    c = TestClient(app)
    try:
        yield c
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)


def _money(x) -> Decimal:
    return Decimal(str(x))


def test_issue_summary_groups_by_label(client):
    resp = client.get("/api/analytics/issues")
    assert resp.status_code == 200
    data = resp.json()

    by = {r["issue_label"]: r for r in data["rows"]}
    # only the two 商学院 monthly issues; void/subscription/CBJ-期号 excluded
    assert set(by) == {"2026-01", "2026-04"}

    assert by["2026-01"]["publication"] == "business_school"
    assert by["2026-01"]["line_count"] == 2
    assert by["2026-01"]["total_quantity"] == 2
    assert _money(by["2026-01"]["total_paid"]) == Decimal("80.00")

    assert by["2026-04"]["line_count"] == 1
    assert by["2026-04"]["total_quantity"] == 2
    assert _money(by["2026-04"]["total_paid"]) == Decimal("80.00")

    assert data["total_issues"] == 2
    assert data["grand_total_quantity"] == 4
    assert _money(data["grand_total_paid"]) == Decimal("160.00")


def test_issue_summary_publication_filter(client):
    # CBJ has no labelled single issues here → empty
    resp = client.get("/api/analytics/issues", params={"publication": "cbj"})
    assert resp.status_code == 200
    assert resp.json()["rows"] == []

    resp = client.get("/api/analytics/issues", params={"publication": "business_school"})
    labels = {r["issue_label"] for r in resp.json()["rows"]}
    assert labels == {"2026-01", "2026-04"}
