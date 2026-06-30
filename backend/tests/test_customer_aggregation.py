"""Tests for 客户管理 (客户=收报人) 聚合 —— customer_service + /api/customers.

Same strategy as ``test_campaign_analytics.py``: a FastAPI app over in-memory
SQLite, auth bypassed via dependency override. Builds full
order → item → allocation → target graphs through the ORM so the
allocation-version filter can be exercised.

核心被验证的口径（见 ``customer_service``）：
* 按 收件人姓名 + 电话 归并（无电话视为同一「无电话」组）。
* **只计当前分配版本**：改派后旧版本(effective_until_issue 非 NULL)的目标不重复计入。
* 排除 草稿/作废订单、退款/取消(commercial_status)、已取消明细、暂停/已替换目标。
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
from app.models.fulfillment_allocation import FulfillmentAllocation
from app.models.fulfillment_target import (
    FulfillmentTarget,
    ShippingChannel,
    TargetStatus,
)
from app.models.order import (
    Order,
    OrderCommercialStatus,
    OrderEntryMethod,
    OrderStatus,
)
from app.models.order_item import (
    FulfillmentType,
    OrderItem,
    OrderItemStatus,
    Publication,
)
from app.models.user import User, UserRole
from app.services.customer_service import get_customer_detail, list_customers


# ---------------------------------------------------------------------------
# ORM graph builders
# ---------------------------------------------------------------------------
def _order(db, *, status=OrderStatus.active, commercial_status=None,
           order_date=date(2026, 6, 1), payer="P"):
    o = Order(
        order_date=order_date,
        entry_method=OrderEntryMethod.excel_import,
        payer_name=payer,
        status=status,
        commercial_status=commercial_status,
        total_amount=Decimal("0"),
        paid_amount=Decimal("0"),
    )
    db.add(o)
    db.flush()
    return o


def _item(db, order, *, fulfillment_type=FulfillmentType.subscription,
          publication=Publication.cbj, status=OrderItemStatus.active,
          issue_label=None, issue_number=None,
          coverage_start=None, coverage_end=None):
    it = OrderItem(
        order_id=order.id,
        publication=publication,
        fulfillment_type=fulfillment_type,
        status=status,
        issue_label=issue_label,
        issue_number=issue_number,
        coverage_start_date=coverage_start,
        coverage_end_date=coverage_end,
        total_quantity=1,
    )
    db.add(it)
    db.flush()
    return it


def _alloc(db, item, *, version_no=1, effective_until_issue=None):
    a = FulfillmentAllocation(
        order_item_id=item.id,
        version_no=version_no,
        effective_from_issue=None,
        effective_until_issue=effective_until_issue,
    )
    db.add(a)
    db.flush()
    return a


def _target(db, item, alloc, *, name, phone=None, address="默认地址", qty=1,
            status=TargetStatus.active, channel=ShippingChannel.zto_outsource):
    t = FulfillmentTarget(
        order_item_id=item.id,
        allocation_id=alloc.id,
        recipient_name=name,
        recipient_phone=phone,
        recipient_address=address,
        quantity=qty,
        status=status,
        shipping_channel=channel,
    )
    db.add(t)
    db.flush()
    return t


def _simple(db, *, name, phone=None, address="默认地址", qty=1, **order_kw):
    """A whole active order → 1 item → 1 current allocation → 1 target."""
    o = _order(db, **order_kw)
    it = _item(db, o)
    a = _alloc(db, it)
    _target(db, it, a, name=name, phone=phone, address=address, qty=qty)
    return o


# ---------------------------------------------------------------------------
@pytest.fixture
def db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


def _by_name(out):
    return {r.recipient_name: r for r in out.rows}


def test_groups_by_name_and_phone_sums_quantity(db):
    # 张三/138 across two orders: qty 2 + 3 = 5, two distinct addresses.
    o1 = _order(db)
    i1 = _item(db, o1)
    a1 = _alloc(db, i1)
    _target(db, i1, a1, name="张三", phone="138", address="北京A", qty=2)

    o2 = _order(db)
    i2 = _item(db, o2)
    a2 = _alloc(db, i2)
    _target(db, i2, a2, name="张三", phone="138", address="北京B", qty=3)
    db.commit()

    out = list_customers(db)
    by = _by_name(out)
    assert out.total == 1
    z = by["张三"]
    assert z.recipient_phone == "138"
    assert z.total_quantity == 5
    assert z.order_count == 2
    assert z.address_count == 2
    assert z.primary_address == "北京B"  # 最近的 target（id 更大）
    assert z.publications == ["cbj"]


def test_superseded_allocation_version_not_double_counted(db):
    """改派后旧版本(effective_until_issue 非空)的目标必须被排除——否则份数虚高。"""
    o = _order(db)
    it = _item(db, o)
    old = _alloc(db, it, version_no=1, effective_until_issue=5)   # superseded
    _target(db, it, old, name="李四", phone="139", address="旧址", qty=9)
    cur = _alloc(db, it, version_no=2, effective_until_issue=None)  # current
    _target(db, it, cur, name="李四", phone="139", address="新址", qty=3)
    db.commit()

    out = list_customers(db)
    by = _by_name(out)
    assert by["李四"].total_quantity == 3          # 不是 12
    assert by["李四"].primary_address == "新址"

    detail = get_customer_detail(db, "李四", "139")
    assert len(detail.lines) == 1                   # 旧版本目标不在明细
    assert detail.total_quantity == 3


def test_excludes_void_refunded_cancelled_and_inactive_targets(db):
    _simple(db, name="生效人", phone="100", qty=1)                    # kept
    _simple(db, name="作废单", phone="200", qty=1, status=OrderStatus.void)
    _simple(db, name="退款单", phone="300", qty=1,
            commercial_status=OrderCommercialStatus.refunded)
    _simple(db, name="取消单", phone="400", qty=1,
            commercial_status=OrderCommercialStatus.cancelled)

    # 取消的明细行 → 排除
    o = _order(db)
    it = _item(db, o, status=OrderItemStatus.cancelled)
    a = _alloc(db, it)
    _target(db, it, a, name="取消明细", phone="500", qty=1)

    # 暂停的目标 → 排除（同单另有有效目标 qty1 → 仅计有效的）
    o2 = _order(db)
    it2 = _item(db, o2)
    a2 = _alloc(db, it2)
    _target(db, it2, a2, name="王五", phone="600", qty=4,
            status=TargetStatus.suspended)
    _target(db, it2, a2, name="王五", phone="600", qty=1,
            status=TargetStatus.active)
    db.commit()

    out = list_customers(db)
    by = _by_name(out)
    assert set(by) == {"生效人", "王五"}
    assert by["王五"].total_quantity == 1            # 暂停的 4 份不计


def test_whitespace_name_phone_variants_collapse_and_detail_matches(db):
    """导入带零散空格：同名同号的空白变体应并为一组，且详情口径与列表逐字节一致。

    回归 review 发现的跨库口径不一致：列表按 Python 规范化键归并、详情曾下推 SQL 等值，
    在 MySQL 大小写/尾空格不敏感排序规则下会破坏「详情和 == 列表行」。修复后详情改为
    TRIM 预筛 + Python 同款规范化收窄，并把姓名也纳入 strip 归并，SQLite 下亦可验证。
    """
    o1 = _order(db)
    i1 = _item(db, o1)
    a1 = _alloc(db, i1)
    _target(db, i1, a1, name="张三", phone="138", address="甲", qty=2)

    o2 = _order(db)
    i2 = _item(db, o2)
    a2 = _alloc(db, i2)
    _target(db, i2, a2, name="张三 ", phone="138 ", address="乙", qty=3)  # 尾随空格
    db.commit()

    out = list_customers(db)
    assert out.total == 1  # 空白变体并为一组
    row = out.rows[0]
    assert row.recipient_name == "张三"  # 代表值已规范化
    assert row.recipient_phone == "138"
    assert row.total_quantity == 5

    detail = get_customer_detail(db, row.recipient_name, row.recipient_phone)
    assert detail.total_quantity == row.total_quantity  # 不变量：详情和 == 列表行
    assert len(detail.lines) == 2


def test_no_phone_grouping_and_detail(db):
    _simple(db, name="无电话", phone=None, address="甲", qty=2)
    _simple(db, name="无电话", phone=None, address="乙", qty=3)
    db.commit()

    out = list_customers(db)
    by = _by_name(out)
    assert out.total == 1
    assert by["无电话"].recipient_phone is None
    assert by["无电话"].total_quantity == 5

    detail = get_customer_detail(db, "无电话", None)
    assert detail.total_quantity == 5
    assert len(detail.lines) == 2


def test_search_filters_by_name_phone_address(db):
    _simple(db, name="张三", phone="13800000001", address="北京朝阳", qty=1)
    _simple(db, name="李四", phone="13900000002", address="上海浦东", qty=1)
    db.commit()

    assert {r.recipient_name for r in list_customers(db, search="张三").rows} == {"张三"}
    assert {r.recipient_name for r in list_customers(db, search="139").rows} == {"李四"}
    assert {r.recipient_name for r in list_customers(db, search="浦东").rows} == {"李四"}
    assert list_customers(db, search="不存在").rows == []


def test_sorted_by_quantity_then_paginated(db):
    _simple(db, name="少量", phone="1", qty=1)
    _simple(db, name="大量", phone="2", qty=10)
    _simple(db, name="中量", phone="3", qty=5)
    db.commit()

    page1 = list_customers(db, page=1, page_size=2)
    assert page1.total == 3
    assert [r.recipient_name for r in page1.rows] == ["大量", "中量"]
    page2 = list_customers(db, page=2, page_size=2)
    assert [r.recipient_name for r in page2.rows] == ["少量"]


# ---------------------------------------------------------------------------
# Endpoint wiring smoke test
# ---------------------------------------------------------------------------
@pytest.fixture
def client():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    seed = TestingSessionLocal()
    o = _order(seed)
    it = _item(seed, o, issue_label="2026-05",
               fulfillment_type=FulfillmentType.single_issue,
               publication=Publication.business_school)
    a = _alloc(seed, it)
    _target(seed, it, a, name="赵六", phone="13700000003", address="广州天河", qty=2)
    seed.commit()
    seed.close()

    fake_user = User(id=1, username="t", password_hash="x", role=UserRole.admin)

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


def test_list_and_detail_endpoints(client):
    resp = client.get("/api/customers")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    row = data["rows"][0]
    assert row["recipient_name"] == "赵六"
    assert row["total_quantity"] == 2
    assert row["publications"] == ["business_school"]

    detail = client.get(
        "/api/customers/detail",
        params={"recipient_name": "赵六", "recipient_phone": "13700000003"},
    )
    assert detail.status_code == 200
    d = detail.json()
    assert d["total_quantity"] == 2
    assert len(d["lines"]) == 1
    assert d["lines"][0]["issue_label"] == "2026-05"
