"""合成 Excel 经 HTTP 预览、逐明细核对期号及原子导入；不连接业务库。"""

import io
from datetime import date
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.order_import import router
from app.auth import get_current_user
from app.database import Base, get_db
from app.models import Order, OrderEvent, OrderItem, PublicationSchedule, User
from app.models.order_source import OrderSource, OrderSourceVersion
from app.models.user import UserRole
from app.order_import_cache import get_order_import_session
from app.seeds.products import seed_products


@pytest.fixture
def env():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    seed_products(db)
    user = User(id=1, username="synthetic-review-admin", password_hash="unused", role=UserRole.admin)
    db.add(user)
    db.add_all([
        PublicationSchedule(year=2026, issue_number=2637, publish_date=date(2026, 1, 19)),
        PublicationSchedule(year=2026, issue_number=2638, publish_date=date(2026, 1, 26)),
        PublicationSchedule(year=2026, issue_number=2639, publish_date=date(2026, 2, 2)),
        PublicationSchedule(year=2026, issue_number=2640, publish_date=date(2026, 2, 9), is_suspended=True),
    ])
    db.commit()
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        yield TestClient(app, raise_server_exceptions=False), db, user
    finally:
        db.close()
        engine.dispose()


def workbook(*, multiple: bool = False, payment: str = "2026-01-23 23:00:00", notes: str = "") -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.append(["订单号", "产品名称", "数量", "原价", "付款金额", "支付方式", "发票",
               "地址", "备注", "下单时间", "支付时间", "订单状态"])
    product = "《中国经营报》最新一期订阅X1,单价:5.0\n"
    ws.append(["SYNTHETIC-REVIEW", product * (2 if multiple else 1), 2 if multiple else 1,
               10 if multiple else 5, 10 if multiple else 5, "微信", "", "合成订户,,合成测试地址", notes,
               "2026-01-23 17:00:00", payment, "卖家已发货"])
    ws.append(["SYNTHETIC-NORMAL", "《中国经营报》全年订阅-618促销活动X1,单价:199.0\n",
               1, 199, 199, "微信", "", "合成订户,,合成测试地址", "",
               "2026-01-23 17:00:00", payment, "卖家已发货"])
    output = io.BytesIO()
    wb.save(output)
    return output.getvalue()


def preview(client: TestClient, **kwargs) -> dict:
    response = client.post("/api/order-import/preview", files={"file": ("synthetic.xlsx", workbook(**kwargs))})
    assert response.status_code == 200, response.text
    return response.json()


def commit(client: TestClient, data: dict, **kwargs):
    return client.post("/api/order-import/commit", json={"session_id": data["session_id"], **kwargs})


def assert_unwritten(db: Session, data: dict) -> None:
    for model in (Order, OrderItem, OrderEvent, OrderSource, OrderSourceVersion):
        assert db.query(model).count() == 0
    assert get_order_import_session(data["session_id"]) is not None


def test_preview_exposes_item_review_and_schedule_choices_without_writing(env):
    client, db, _ = env
    data = preview(client)
    item = data["rows"][0]["items"][0]
    assert item["issue_number"] == 2638
    assert item["issue_review"]["suggested_issue_number"] == 2638
    assert item["issue_review"]["suggested_publish_date"] == "2026-01-26"
    assert "翻期临界" in item["issue_review"]["reason"]
    assert data["rows"][1]["items"][0]["issue_review"] is None
    assert {o["issue_number"] for o in data["issue_review_options"]} == {2637, 2638, 2639}
    assert_unwritten(db, data)


@pytest.mark.parametrize("extra", [{}, {"issue_overrides": {"SYNTHETIC-REVIEW#0": 2637}}])
def test_missing_review_blocks_entire_batch_and_cannot_use_legacy_override(env, extra):
    client, db, _ = env
    data = preview(client)
    response = commit(client, data, **extra)
    assert response.status_code == 409
    assert "核对期号" in response.json()["detail"]
    assert_unwritten(db, data)


@pytest.mark.parametrize("selected", [2638, 2637])
def test_confirm_or_correct_records_selected_issue_and_audit_preserving_source(env, selected):
    client, db, user = env
    data = preview(client)
    response = commit(client, data, confirmed_issue_numbers={"SYNTHETIC-REVIEW#0": selected})
    assert response.status_code == 200, response.text
    assert response.json()["created"] == 2
    order = db.query(Order).filter_by(external_order_no="SYNTHETIC-REVIEW").one()
    assert order.items[0].issue_number == selected
    assert order.items[0].subtotal == order.paid_amount == Decimal("5")
    event = next(e for e in db.query(OrderEvent).filter_by(order_id=order.id)
                 if e.payload_json.get("operation") == "import_issue_review")
    assert event.operator_id == user.id
    assert event.payload_json["item_id"] == order.items[0].id
    assert event.payload_json["suggested_issue_number"] == 2638
    assert event.payload_json["issue_number"] == selected
    assert event.payload_json["publish_date"] == ("2026-01-26" if selected == 2638 else "2026-01-19")
    assert "翻期临界" in event.payload_json["review_reason"]
    source = db.query(OrderSource).filter_by(external_order_no="SYNTHETIC-REVIEW").one()
    assert db.query(OrderSourceVersion).filter_by(source_id=source.id).one().snapshot == data["rows"][0]["source_snapshot"]
    assert get_order_import_session(data["session_id"]) is None
    assert commit(client, data, confirmed_issue_numbers={"SYNTHETIC-REVIEW#0": selected}).status_code == 400
    assert db.query(Order).count() == 2


def test_each_item_needs_its_own_confirmation_and_can_have_a_different_issue(env):
    client, db, _ = env
    data = preview(client, multiple=True)
    assert len(data["rows"][0]["items"]) == 2
    assert commit(client, data, confirmed_issue_numbers={"SYNTHETIC-REVIEW#0": 2638}).status_code == 409
    assert_unwritten(db, data)
    response = commit(client, data, confirmed_issue_numbers={"SYNTHETIC-REVIEW#0": 2638, "SYNTHETIC-REVIEW#1": 2637})
    assert response.status_code == 200, response.text
    order = db.query(Order).filter_by(external_order_no="SYNTHETIC-REVIEW").one()
    assert [i.issue_number for i in sorted(order.items, key=lambda i: i.id)] == [2638, 2637]


@pytest.mark.parametrize("key", ["OTHER#0", "SYNTHETIC-REVIEW#9", "SYNTHETIC-NORMAL#0"])
def test_review_cannot_target_another_order_or_nonreview_item(env, key):
    client, db, _ = env
    data = preview(client)
    response = commit(client, data, confirmed_issue_numbers={"SYNTHETIC-REVIEW#0": 2638, key: 2637})
    assert response.status_code == 409
    assert_unwritten(db, data)


@pytest.mark.parametrize("value", [9999, 2640, 0, -1, 2638.5, True, "2638", None])
def test_rejects_unknown_suspended_or_invalid_issue(env, value):
    client, db, _ = env
    data = preview(client)
    assert commit(client, data, confirmed_issue_numbers={"SYNTHETIC-REVIEW#0": value}).status_code == 422
    assert_unwritten(db, data)


@pytest.mark.parametrize("change", ["date", "suspend", "delete", "duplicate"])
def test_schedule_changed_after_preview_requires_new_preview(env, change):
    client, db, _ = env
    data = preview(client)
    schedule = db.query(PublicationSchedule).filter_by(issue_number=2638).one()
    if change == "date":
        schedule.publish_date = date(2026, 1, 27)
    elif change == "suspend":
        schedule.is_suspended = True
    elif change == "delete":
        db.delete(schedule)
    else:
        db.add(PublicationSchedule(year=2026, issue_number=2638, publish_date=date(2026, 1, 28)))
    db.commit()
    response = commit(client, data, confirmed_issue_numbers={"SYNTHETIC-REVIEW#0": 2638})
    assert response.status_code == 409
    assert "重新预览" in response.json()["detail"]
    assert_unwritten(db, data)


def test_review_failure_rolls_back_orders_sources_and_audit_and_can_retry(env, monkeypatch):
    from app.services import order_source_service
    client, db, _ = env
    data = preview(client)
    original = order_source_service.save_import_source
    def fail(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("synthetic failure")
    monkeypatch.setattr(order_source_service, "save_import_source", fail)
    assert commit(client, data, confirmed_issue_numbers={"SYNTHETIC-REVIEW#0": 2637}).status_code == 500
    assert_unwritten(db, data)
    cached = get_order_import_session(data["session_id"])
    assert cached["rows"][0]["order_create"]["items"][0]["issue_number"] == 2638
    monkeypatch.setattr(order_source_service, "save_import_source", original)
    assert commit(client, data, confirmed_issue_numbers={"SYNTHETIC-REVIEW#0": 2638}).status_code == 200


def test_review_keeps_admin_and_session_owner_checks(env):
    client, db, user = env
    data = preview(client)
    user.role = UserRole.viewer
    assert commit(client, data, confirmed_issue_numbers={"SYNTHETIC-REVIEW#0": 2638}).status_code == 403
    user.role = UserRole.admin
    get_order_import_session(data["session_id"])["owner_id"] = 999
    assert commit(client, data, confirmed_issue_numbers={"SYNTHETIC-REVIEW#0": 2638}).status_code == 403
    assert_unwritten(db, data)


def test_clean_latest_issue_and_source_updates_do_not_require_issue_review(env):
    client, db, _ = env
    data = preview(client, payment="2026-01-21 12:00:00")
    assert data["rows"][0]["items"][0]["issue_review"] is None
    assert commit(client, data).status_code == 200
    data = preview(client, notes="合成来源备注变化")
    assert data["rows"][0]["decision"] == "source_update"
    assert data["rows"][0]["items"] == []
    assert commit(client, data, confirmed_source_updates=["SYNTHETIC-REVIEW", "SYNTHETIC-NORMAL"]).status_code == 200
    assert db.query(Order).count() == 2


@pytest.mark.parametrize("payment", ["", "2026-01-01 12:00:00", "2026-03-01 12:00:00"])
def test_other_uncertain_latest_issue_suggestions_also_need_review(env, payment):
    client, db, _ = env
    data = preview(client, payment=payment)
    assert data["rows"][0]["items"][0]["issue_review"] is not None
    assert commit(client, data).status_code == 409
    assert_unwritten(db, data)
