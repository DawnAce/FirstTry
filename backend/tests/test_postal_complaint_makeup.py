from datetime import date
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import get_current_user, require_admin
from app.database import Base, get_db
from app.main import app
from app.models import (
    Issue,
    Order,
    OrderEntryMethod,
    OrderStatus,
    PostalComplaint,
    PostalComplaintStatus,
    ShippingDetail,
    ShippingDetailSourceType,
)


@pytest.fixture
def client_and_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = session_factory()
    order = Order(
        order_date=date(2026, 8, 1),
        entry_method=OrderEntryMethod.manual,
        payer_name="宋女士",
        total_amount=100,
        paid_amount=100,
        status=OrderStatus.active,
    )
    db.add(order)
    db.flush()
    complaint = PostalComplaint(
        order_id=order.id,
        year=2026,
        complaint_date=date(2026, 8, 4),
        missing_issues="漏收第 3001 期",
        snap_name="宋女士",
        snap_phone="13800000000",
        snap_address="北京市朝阳区测试路 1 号",
        status=PostalComplaintStatus.open,
    )
    db.add_all([
        complaint,
        Issue(issue_number=3001, publish_date=date(2026, 8, 3)),
        Issue(issue_number=3002, publish_date=date(2026, 8, 10)),
    ])
    db.commit()
    complaint_id = complaint.id
    order_id = order.id
    db.close()

    def override_get_db():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    fake = SimpleNamespace(id=1, role="admin", username="admin")
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = lambda: fake
    app.dependency_overrides[require_admin] = lambda: fake
    client = TestClient(app)
    try:
        yield client, session_factory, complaint_id, order_id
    finally:
        app.dependency_overrides.clear()


def test_makeup_task_creates_traceable_zto_rows_and_syncs_shipping(client_and_session):
    client, session_factory, complaint_id, order_id = client_and_session

    created = client.post(
        f"/api/postal/tickets/{complaint_id}/makeups",
        json={
            "items": [
                {"issue_number": 3001, "quantity": 1},
                {"issue_number": 3002, "quantity": 2},
            ],
            "notes": "漏收补发",
        },
    )
    assert created.status_code == 201, created.text
    task = created.json()
    assert task["status"] == "ready"
    assert task["order_id"] == order_id
    assert len(task["items"]) == 2

    db = session_factory()
    rows = db.query(ShippingDetail).order_by(ShippingDetail.issue_number).all()
    assert [row.source_type for row in rows] == [
        ShippingDetailSourceType.complaint_makeup,
        ShippingDetailSourceType.complaint_makeup,
    ]
    assert [row.order_item_id for row in rows] == [None, None]
    assert all(row.order_id == order_id for row in rows)
    first_id = rows[0].id
    second_id = rows[1].id
    db.close()

    first_ship = client.post(
        f"/api/shipping-details/{first_id}/ship",
        json={"tracking_no": "ZT10001", "shipped_quantity": 1},
    )
    assert first_ship.status_code == 200
    still_ready = client.get("/api/postal/makeups", params={"order_id": order_id}).json()["rows"][0]
    assert still_ready["status"] == "ready"

    second_ship = client.post(
        f"/api/shipping-details/{second_id}/ship",
        json={"tracking_no": "ZT10001", "shipped_quantity": 2},
    )
    assert second_ship.status_code == 200
    shipped = client.get("/api/postal/makeups", params={"order_id": order_id}).json()["rows"][0]
    assert shipped["status"] == "shipped"
    assert shipped["tracking_no"] == "ZT10001"


def test_cancel_ready_makeup_removes_zto_rows_but_keeps_audit_task(client_and_session):
    client, session_factory, complaint_id, _ = client_and_session
    task = client.post(
        f"/api/postal/tickets/{complaint_id}/makeups",
        json={"items": [{"issue_number": 3001, "quantity": 1}]},
    ).json()

    cancelled = client.post(f"/api/postal/makeups/{task['id']}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["items"][0]["shipping_detail_id"] is None

    db = session_factory()
    assert db.query(ShippingDetail).count() == 0
    db.close()


def test_makeup_requires_complaint_and_existing_issue(client_and_session):
    client, _, complaint_id, _ = client_and_session
    missing_issue = client.post(
        f"/api/postal/tickets/{complaint_id}/makeups",
        json={"items": [{"issue_number": 9999, "quantity": 1}]},
    )
    assert missing_issue.status_code == 400

    duplicate_issue = client.post(
        f"/api/postal/tickets/{complaint_id}/makeups",
        json={"items": [
            {"issue_number": 3001, "quantity": 1},
            {"issue_number": 3001, "quantity": 1},
        ]},
    )
    assert duplicate_issue.status_code == 400
