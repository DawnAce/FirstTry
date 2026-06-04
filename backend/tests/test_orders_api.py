"""Integration tests for the orders REST API.

Strategy: spin up the FastAPI app against an in-memory SQLite database
so the routing, schemas, service layer and ORM all execute end-to-end.
Authentication is bypassed via dependency override so tests don't need
to mint tokens.

What this complements (and does *not* duplicate):

* ``test_order_service.py`` already covers the service-layer business
  rules with a FakeDb. Here we just verify HTTP wiring, status codes,
  request validation and the round-trip serialisation.
* MySQL-specific schema concerns (FK use_alter, server_default text,
  index drops) are covered by the migration round-trip already run
  against the dev database; SQLite glosses over them.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import get_current_user
from app.database import Base, get_db
from app.main import app
from app.models.user import User, UserRole


# ---------------------------------------------------------------------------
# Test app + DB fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def client():
    """A TestClient backed by a fresh in-memory SQLite database.

    StaticPool keeps the same connection across the session so the in-memory
    DB persists between requests. ``Base.metadata.create_all`` builds the
    full schema from the SQLAlchemy models.
    """
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    fake_user = User(
        id=1,
        username="tester",
        password_hash="x",
        role=UserRole.admin,
    )

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    def override_get_current_user():
        return fake_user

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user

    # Plain instantiation (no context manager) avoids triggering main.py's
    # @app.on_event("startup") warmup_pool, which would try to connect to
    # the real MySQL engine and hang the test suite.
    c = TestClient(app)
    try:
        yield c
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)


def _make_create_payload(
    *,
    payer_name="Alice",
    targets_count=2,
    total_quantity=2,
    source_type="ecommerce",
    fulfillment_type="subscription",
    coverage_start="2026-03-01",
    coverage_end="2026-12-31",
) -> dict:
    targets = [
        {
            "recipient_name": f"R{i}",
            "recipient_address": f"Addr {i}",
            "quantity": 1,
        }
        for i in range(targets_count)
    ]
    return {
        "order_date": "2026-03-01",
        "source_type": source_type,
        "payer_name": payer_name,
        "total_amount": "180",
        "items": [
            {
                "fulfillment_type": fulfillment_type,
                "coverage_start_date": coverage_start,
                "coverage_end_date": coverage_end,
                "total_quantity": total_quantity,
                "unit_price": "60",
                "subtotal": "180",
                "targets": targets,
            }
        ],
    }


# ---------------------------------------------------------------------------
# POST /api/orders (create)
# ---------------------------------------------------------------------------


def test_create_order_returns_201_with_draft_status(client):
    r = client.post("/api/orders", json=_make_create_payload())
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "draft"
    assert body["order_code"] is None
    # V1.1 PR-A: 即使客户端 payload 传 source_type="ecommerce"，
    # 服务端也会硬归一为 manual（provenance 由 entrypoint 控制）
    assert body["source_type"] == "manual"
    assert len(body["items"]) == 1
    assert body["items"][0]["total_quantity"] == 2
    # nested progress is computed even at draft (snapshot=None, so drift=None)
    progress = body["items"][0]["progress"]
    assert progress["expected_at_creation"] is None
    assert progress["drift"] is None


def test_create_order_ignores_client_source_type_and_persists_manual(client):
    """V1.1 PR-A invariant via the HTTP layer: even if a stale client (or 3rd-party
    integration) POSTs a non-manual source_type, the server must persist 'manual'.
    Provenance is controlled by the entrypoint, not trusted from the request body.
    """
    for spoofed in ("ecommerce", "corporate_transfer", "vip_gift", "mail_annual"):
        payload = _make_create_payload(source_type=spoofed)
        r = client.post("/api/orders", json=payload)
        assert r.status_code == 201, f"{spoofed}: {r.text}"
        assert r.json()["source_type"] == "manual", (
            f"client claimed source_type={spoofed}, "
            f"server must normalize to manual"
        )


def test_create_order_validates_targets_quantity_sum(client):
    """Pydantic validator rejects mismatched targets sum -> HTTP 422."""
    payload = _make_create_payload(total_quantity=5, targets_count=2)
    r = client.post("/api/orders", json=payload)
    assert r.status_code == 422
    assert "target quantities" in r.text.lower() or "sum" in r.text.lower()


def test_create_order_rejects_empty_items(client):
    payload = _make_create_payload()
    payload["items"] = []
    r = client.post("/api/orders", json=payload)
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# POST /api/orders/{id}/confirm
# ---------------------------------------------------------------------------


def test_confirm_order_transitions_to_active_and_assigns_code(client):
    created = client.post("/api/orders", json=_make_create_payload()).json()
    r = client.post(f"/api/orders/{created['id']}/confirm")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "active"
    assert body["order_code"] is not None
    assert body["order_code"].startswith("ORD-2026-")


def test_confirm_order_already_active_returns_409(client):
    created = client.post("/api/orders", json=_make_create_payload()).json()
    client.post(f"/api/orders/{created['id']}/confirm")
    r = client.post(f"/api/orders/{created['id']}/confirm")
    assert r.status_code == 409


def test_confirm_order_not_found_returns_404(client):
    r = client.post("/api/orders/99999/confirm")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# PUT /api/orders/{id} (update)
# ---------------------------------------------------------------------------


def test_update_draft_allows_structural_fields(client):
    created = client.post("/api/orders", json=_make_create_payload()).json()
    r = client.put(
        f"/api/orders/{created['id']}",
        json={"payer_name": "Bob", "notes": "edited"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["payer_name"] == "Bob"
    assert body["notes"] == "edited"


def test_update_active_blocks_structural_fields_with_422(client):
    created = client.post("/api/orders", json=_make_create_payload()).json()
    client.post(f"/api/orders/{created['id']}/confirm")
    r = client.put(
        f"/api/orders/{created['id']}",
        json={"payer_name": "Changed"},
    )
    assert r.status_code == 422
    assert "payer_name" in r.text


def test_update_active_allows_notes(client):
    created = client.post("/api/orders", json=_make_create_payload()).json()
    client.post(f"/api/orders/{created['id']}/confirm")
    r = client.put(
        f"/api/orders/{created['id']}",
        json={"notes": "after confirm"},
    )
    assert r.status_code == 200
    assert r.json()["notes"] == "after confirm"


def test_invoice_fields_round_trip_on_create_and_active_update(client):
    """V1.1 发票拆分：抬头 / 税号 / 接收邮箱 三个字段独立持久化，
    在 active 状态下都允许编辑（运营经常事后补 / 改这些信息）。
    """
    payload = _make_create_payload()
    payload.update(
        {
            "invoice_required": True,
            "invoice_title": "东莞农村商业银行股份有限公司",
            "invoice_tax_no": "914419007829859746",
            "invoice_recipient_email": "ar@example.com",
        }
    )
    created = client.post("/api/orders", json=payload).json()
    assert created["invoice_required"] is True
    assert created["invoice_title"] == "东莞农村商业银行股份有限公司"
    assert created["invoice_tax_no"] == "914419007829859746"
    assert created["invoice_recipient_email"] == "ar@example.com"

    # confirm → active, then edit invoice fields
    client.post(f"/api/orders/{created['id']}/confirm")
    r = client.put(
        f"/api/orders/{created['id']}",
        json={
            "invoice_title": "新抬头",
            "invoice_tax_no": "91440100MA5XXXXXX0",
            "invoice_recipient_email": "finance@example.com",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["invoice_title"] == "新抬头"
    assert body["invoice_tax_no"] == "91440100MA5XXXXXX0"
    assert body["invoice_recipient_email"] == "finance@example.com"


def test_create_order_round_trips_subscription_pricing_fields(client):
    payload = _make_create_payload()
    payload["items"][0].update(
        {
            "subscription_term": "half_year",
            "delivery_method": "zto_mf",
            "term_start_month": "2026-01",
            "unit_price": "195",
            "subtotal": "390",
            "total_quantity": 2,
        }
    )

    r = client.post("/api/orders", json=payload)

    assert r.status_code == 201, r.text
    item = r.json()["items"][0]
    assert item["subscription_term"] == "half_year"
    assert item["delivery_method"] == "zto_mf"
    assert item["term_start_month"] == "2026-01"
    assert item["unit_price"] == "195.00"
    assert item["subtotal"] == "390.00"


def test_create_order_rejects_invalid_subscription_term_start_month(client):
    payload = _make_create_payload()
    payload["items"][0].update({"term_start_month": "2026-13"})

    r = client.post("/api/orders", json=payload)

    assert r.status_code == 422
    assert "term_start_month" in r.text


def test_update_order_not_found_returns_404(client):
    r = client.put("/api/orders/99999", json={"notes": "x"})
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# POST /api/orders/{id}/void
# ---------------------------------------------------------------------------


def test_void_order_transitions_to_void(client):
    created = client.post("/api/orders", json=_make_create_payload()).json()
    client.post(f"/api/orders/{created['id']}/confirm")
    r = client.post(
        f"/api/orders/{created['id']}/void",
        json={"reason": "customer cancelled"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "void"


def test_void_order_requires_reason(client):
    created = client.post("/api/orders", json=_make_create_payload()).json()
    r = client.post(
        f"/api/orders/{created['id']}/void", json={"reason": ""}
    )
    assert r.status_code == 422


def test_void_order_already_void_returns_409(client):
    created = client.post("/api/orders", json=_make_create_payload()).json()
    client.post(f"/api/orders/{created['id']}/void", json={"reason": "x"})
    r = client.post(
        f"/api/orders/{created['id']}/void", json={"reason": "again"}
    )
    assert r.status_code == 409


# ---------------------------------------------------------------------------
# GET /api/orders (list)
# ---------------------------------------------------------------------------


def test_list_orders_returns_rows_and_total(client):
    client.post("/api/orders", json=_make_create_payload(payer_name="A"))
    client.post("/api/orders", json=_make_create_payload(payer_name="B"))
    r = client.get("/api/orders")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 2
    assert len(body["rows"]) == 2
    payers = {row["payer_name"] for row in body["rows"]}
    assert payers == {"A", "B"}


def test_list_orders_filters_by_status(client):
    a = client.post("/api/orders", json=_make_create_payload(payer_name="Active")).json()
    client.post("/api/orders", json=_make_create_payload(payer_name="StillDraft"))
    client.post(f"/api/orders/{a['id']}/confirm")

    r = client.get("/api/orders?status=active")
    body = r.json()
    assert body["total"] == 1
    assert body["rows"][0]["payer_name"] == "Active"


def test_list_orders_filters_by_payer_name_like(client):
    client.post("/api/orders", json=_make_create_payload(payer_name="李四"))
    client.post("/api/orders", json=_make_create_payload(payer_name="张三"))
    r = client.get("/api/orders?payer_name_like=李")
    body = r.json()
    assert body["total"] == 1
    assert body["rows"][0]["payer_name"] == "李四"


def test_list_orders_pagination(client):
    for i in range(3):
        client.post("/api/orders", json=_make_create_payload(payer_name=f"P{i}"))
    r = client.get("/api/orders?limit=2&skip=0")
    body = r.json()
    assert body["total"] == 3
    assert len(body["rows"]) == 2


# ---------------------------------------------------------------------------
# GET /api/orders/{id} (detail)
# ---------------------------------------------------------------------------


def test_get_order_detail_returns_nested_allocations_and_targets(client):
    created = client.post("/api/orders", json=_make_create_payload()).json()
    r = client.get(f"/api/orders/{created['id']}")
    assert r.status_code == 200
    body = r.json()
    assert len(body["items"]) == 1
    item = body["items"][0]
    assert len(item["allocations"]) == 1
    assert item["allocations"][0]["version_no"] == 1
    assert len(item["allocations"][0]["targets"]) == 2
    assert "progress" in item


def test_get_order_detail_not_found(client):
    r = client.get("/api/orders/99999")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# GET /api/orders/{id}/events
# ---------------------------------------------------------------------------


def test_list_events_after_full_lifecycle(client):
    created = client.post("/api/orders", json=_make_create_payload()).json()
    client.put(f"/api/orders/{created['id']}", json={"notes": "edited"})
    client.post(f"/api/orders/{created['id']}/confirm")
    client.post(
        f"/api/orders/{created['id']}/void", json={"reason": "done"}
    )

    r = client.get(f"/api/orders/{created['id']}/events")
    assert r.status_code == 200
    types = [e["event_type"] for e in r.json()]
    # newest-first ordering
    assert types[0] == "voided"
    assert "confirmed" in types
    assert "modified" in types
    assert "created" in types


def test_list_events_not_found_propagates_404(client):
    r = client.get("/api/orders/99999/events")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# GET /api/orders/{id}/fulfillment-progress
# ---------------------------------------------------------------------------


def test_get_progress_returns_per_item_summary(client):
    created = client.post("/api/orders", json=_make_create_payload()).json()
    client.post(f"/api/orders/{created['id']}/confirm")
    r = client.get(f"/api/orders/{created['id']}/fulfillment-progress")
    assert r.status_code == 200
    progress_list = r.json()
    assert len(progress_list) == 1
    p = progress_list[0]
    assert "expected_at_creation" in p
    assert "current_expected" in p
    assert "drift" in p
    assert p["synced_count"] == 0
    assert p["skipped_count"] == 0


def test_get_progress_not_found_404(client):
    r = client.get("/api/orders/99999/fulfillment-progress")
    assert r.status_code == 404
