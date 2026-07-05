"""全局搜索 API · HTTP 测试（In-memory SQLite + TestClient）。"""

from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import get_current_user
from app.database import Base, get_db
from app.main import app
from app.models import (
    FulfillmentType,
    Issue,
    IssueStatus,
    Order,
    OrderEntryMethod,
    OrderStatus,
    Product,
    Recipient,
    RecipientType,
)


@pytest.fixture
def client():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TS = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    db = TS()
    db.add(Order(
        order_code="CBJ-001", external_order_no="TB88888", order_date=date(2026, 1, 1),
        entry_method=OrderEntryMethod.manual, payer_name="张三", payer_contact="13900000000",
        total_amount=Decimal("240.00"), status=OrderStatus.active,
    ))
    db.add(Recipient(name="李四", phone="13811112222", type=RecipientType.reader))
    db.add(Product(
        code="CBJ-1Y", display_name="中国经营报 · 全年订阅",
        fulfillment_type=FulfillmentType.subscription,
    ))
    db.add(Issue(issue_number=2099, publish_date=date(2026, 1, 3), status=IssueStatus.draft))
    db.commit()
    db.close()

    def override_get_db():
        d = TS()
        try:
            yield d
        finally:
            d.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1, role="admin", username="admin")
    c = TestClient(app)
    try:
        yield c
    finally:
        app.dependency_overrides.clear()


def _items(client, q):
    r = client.get("/api/search", params={"q": q})
    assert r.status_code == 200, r.text
    return r.json()["items"]


def test_search_order_and_product_by_shared_prefix(client):
    items = _items(client, "CBJ")
    types = {i["type"] for i in items}
    assert "order" in types and "product" in types
    order = next(i for i in items if i["type"] == "order")
    assert order["ref"] == "TB88888"           # 精确定位串=外部单号
    assert "张三" in (order["subtitle"] or "")   # 副标题含付款人


def test_search_order_by_payer_and_external_no(client):
    assert any(i["type"] == "order" and i["title"] == "CBJ-001" for i in _items(client, "张三"))
    assert any(i["type"] == "order" for i in _items(client, "TB88888"))


def test_search_recipient_by_name(client):
    r = next(i for i in _items(client, "李四") if i["type"] == "recipient")
    assert r["title"] == "李四" and r["ref"] == "李四"


def test_issue_matches_only_on_digits(client):
    items = _items(client, "2099")
    assert any(i["type"] == "issue" and i["title"] == "第 2099 期" for i in items)
    assert all(i["type"] != "issue" for i in _items(client, "李四"))  # 非数字不命中期数


def test_empty_or_blank_query_returns_empty(client):
    assert _items(client, "") == []
    assert _items(client, "   ") == []
