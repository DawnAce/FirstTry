"""批次投递单位核对：合成数据、跨页批量、权限、冲突及原子审计。"""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import get_current_user
from app.database import Base, get_db
from app.main import app
from app.models import (
    OperationLog, Partner, PartnerType, PostalDelivery, PostalDeliverySourceType,
    SubscriptionBatch, SubscriptionImportVersion, SubscriptionImportStatus, SubscriptionRecord, UserRole,
)


@pytest.fixture
def env():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, autoflush=False)
    db = sessions()
    units = [Partner(name=n, partner_type=t, active=active) for n, t, active in [
        ("北京集订分送", PartnerType.distribution, True),
        ("广东集订分送", PartnerType.distribution, True),
        ("测试物流", PartnerType.logistics, True),
        ("停用分送", PartnerType.distribution, False),
    ]]
    batch = SubscriptionBatch(year=2026, start_month=10)
    other = SubscriptionBatch(year=2026, start_month=9)
    db.add_all([*units, batch, other])
    db.flush()
    version = SubscriptionImportVersion(batch_id=batch.id, version_no=1, status=SubscriptionImportStatus.active)
    db.add(version)
    db.flush()
    batch.active_version_id = version.id
    for i in range(57):
        db.add(PostalDelivery(
            year=2026, delivery_no=str(i + 1), recipient_name=f"测试读者{i + 1}",
            recipient_address="测试地址", recipient_province="广东省", copies=1,
            subscription_batch_id=batch.id if i < 56 else other.id,
            is_archived=i == 55, source_type=PostalDeliverySourceType.subscription_generated,
            distribution_unit_id=units[1].id,
        ))
    db.commit()
    user = SimpleNamespace(id=1, username="test_admin", role=UserRole.admin)

    def dependency():
        with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = dependency
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        yield TestClient(app), db, batch, units, user
    finally:
        app.dependency_overrides.clear()
        db.close()
        engine.dispose()


def _url(batch):
    return f"/api/subscription/batches/{batch.id}/distribution-units"


def _request(client, batch, **changes):
    response = client.get(_url(batch))
    assert response.status_code == 200
    data = response.json()
    return {"request_id": str(uuid4()), "active_version_id": data["active_version_id"],
            "snapshot": data["snapshot"], "updates": [], **changes}


def test_paginated_batch_scope_and_summary(env):
    client, _, batch, units, _ = env
    first = client.get(_url(batch)).json()
    second = client.get(_url(batch), params={"page": 2}).json()
    assert first["total"] == 55
    assert len(first["rows"]) == 50 and len(second["rows"]) == 5
    assert first["snapshot"] == second["snapshot"]
    assert first["unit_counts"] == [{"id": units[1].id, "name": units[1].name, "count": 55}]
    assert {unit["id"] for unit in first["units"]} == {units[0].id, units[1].id}


def test_all_pages_with_single_exception_and_idempotent_audit(env):
    client, db, batch, units, _ = env
    payload = _request(client, batch, all_distribution_unit_id=units[0].id,
                       updates=[{"delivery_id": 55, "distribution_unit_id": units[1].id}])
    response = client.put(_url(batch), json=payload)
    assert response.status_code == 200, response.text
    assert response.json() == {"changed": 54}
    assert client.put(_url(batch), json=payload).json() == {"changed": 54}
    db.expire_all()
    assert db.get(PostalDelivery, 54).distribution_unit_id == units[0].id
    for delivery_id in (55, 56, 57):
        assert db.get(PostalDelivery, delivery_id).distribution_unit_id == units[1].id
    audit = db.query(OperationLog).filter_by(action="update_distribution_units").one()
    assert audit.user_id == 1 and audit.record_id == batch.id
    assert len(audit.changes["deliveries"]) == 54
    assert audit.changes["deliveries"][0]["distribution_unit_id"] == {"old": units[1].id, "new": units[0].id}


def test_selected_rows_only(env):
    client, db, batch, units, _ = env
    payload = _request(client, batch, updates=[{"delivery_id": i, "distribution_unit_id": units[0].id} for i in (1, 55)])
    assert client.put(_url(batch), json=payload).json() == {"changed": 2}
    db.expire_all()
    assert db.query(PostalDelivery).filter_by(distribution_unit_id=units[0].id).count() == 2


@pytest.mark.parametrize("unit_index", [2, 3])
def test_invalid_or_inactive_unit_does_not_write(env, unit_index):
    client, db, batch, units, _ = env
    payload = _request(client, batch, all_distribution_unit_id=units[unit_index].id)
    assert client.put(_url(batch), json=payload).status_code == 422
    assert db.query(OperationLog).count() == 0


@pytest.mark.parametrize("delivery_id", [56, 57, 99999])
def test_archived_foreign_or_missing_row_rejects_whole_request(env, delivery_id):
    client, db, batch, units, _ = env
    payload = _request(client, batch, updates=[{"delivery_id": i, "distribution_unit_id": units[0].id} for i in (1, delivery_id)])
    assert client.put(_url(batch), json=payload).status_code == 409
    db.expire_all()
    assert db.get(PostalDelivery, 1).distribution_unit_id == units[1].id
    assert db.query(OperationLog).count() == 0


@pytest.mark.parametrize("change", ["unit", "visible_field", "version", "membership"])
def test_stale_snapshot_rejects_overwrite(env, change):
    client, db, batch, units, _ = env
    payload = _request(client, batch, all_distribution_unit_id=units[0].id)
    if change == "unit":
        db.get(PostalDelivery, 1).distribution_unit_id = None
    elif change == "visible_field":
        # 即使数据库 updated_at 仍处于同一秒，核对窗口展示字段变化也必须使快照失效。
        delivery = db.get(PostalDelivery, 1)
        original_updated_at = delivery.updated_at
        delivery.recipient_city = "同秒变更后的城市"
        delivery.updated_at = original_updated_at
    elif change == "membership":
        db.get(PostalDelivery, 1).is_archived = True
    else:
        batch.active_version_id = None
    db.commit()
    assert client.put(_url(batch), json=payload).status_code == 409
    assert db.query(OperationLog).count() == 0


def test_viewer_cannot_save(env):
    client, _, batch, units, user = env
    payload = _request(client, batch, all_distribution_unit_id=units[0].id)
    user.role = UserRole.viewer
    assert client.put(_url(batch), json=payload).status_code == 403


def test_audit_failure_rolls_back_delivery_changes(env, monkeypatch):
    from app.services import subscription_distribution_service as svc
    client, db, batch, units, _ = env
    payload = _request(client, batch, all_distribution_unit_id=units[0].id)

    def fail(*args, **kwargs):
        raise RuntimeError("synthetic audit failure")

    monkeypatch.setattr(svc, "record_operation", fail)
    with pytest.raises(RuntimeError, match="synthetic audit failure"):
        client.put(_url(batch), json=payload)
    db.expire_all()
    assert db.query(PostalDelivery).filter_by(distribution_unit_id=units[0].id).count() == 0


def test_reactivation_keeps_original_province_assignment(env):
    client, db, batch, units, _ = env
    db.add(SubscriptionRecord(version_id=batch.active_version_id, name="测试读者1", province="广东省",
                              address="测试地址", copies=1))
    db.commit()
    payload = _request(client, batch, updates=[{"delivery_id": 1, "distribution_unit_id": units[0].id}])
    assert client.put(_url(batch), json=payload).json() == {"changed": 1}
    response = client.post(f"/api/subscription/imports/{batch.active_version_id}/activate")
    assert response.status_code == 200, response.text
    db.expire_all()
    assert db.get(PostalDelivery, 1).distribution_unit_id == units[1].id
    assert db.get(PostalDelivery, 1).is_archived is False


def test_duplicate_rows_empty_request_and_reused_request_id(env):
    client, db, batch, units, _ = env
    payload = _request(client, batch)
    assert client.put(_url(batch), json=payload).status_code == 422
    update = {"delivery_id": 1, "distribution_unit_id": units[0].id}
    payload["updates"] = [update, update]
    assert client.put(_url(batch), json=payload).status_code == 422
    payload["updates"] = [update]
    assert client.put(_url(batch), json=payload).status_code == 200
    payload["updates"] = [{"delivery_id": 2, "distribution_unit_id": units[0].id}]
    assert client.put(_url(batch), json=payload).status_code == 409
    assert db.query(OperationLog).count() == 1


def test_empty_batch_and_unactivated_batch(env):
    client, db, batch, _, _ = env
    db.query(PostalDelivery).filter_by(subscription_batch_id=batch.id).update({"is_archived": True})
    db.commit()
    assert client.get(_url(batch)).json()["total"] == 0
    batch.active_version_id = None
    db.commit()
    assert client.get(_url(batch)).status_code == 409
    assert client.get(_url(batch), params={"page": 0}).status_code == 422
