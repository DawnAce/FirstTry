"""商学院按期发行量 = 单期销量 + 覆盖该期的订阅（含合刊去重、空覆盖标注）。

GET /api/analytics/bs-circulation —— 订阅按覆盖期落到商学院刊历(bs_issues)展开。
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
from app.seeds.bs_issues import seed_bs_issues
from app.services.order_analytics_service import summarize_bs_circulation


def _order(db, *, status=OrderStatus.active, items):
    o = Order(order_date=date(2026, 6, 1), entry_method=OrderEntryMethod.excel_import,
              payer_name="X", status=status)
    db.add(o)
    db.flush()
    for it in items:
        it.order_id = o.id
        db.add(it)
    return o


def _single(label, qty):
    return OrderItem(publication=Publication.business_school,
                     fulfillment_type=FulfillmentType.single_issue, issue_label=label,
                     total_quantity=qty, subtotal=Decimal("40"))


def _sub(cov_start, cov_end, qty):
    return OrderItem(publication=Publication.business_school,
                     fulfillment_type=FulfillmentType.subscription, total_quantity=qty,
                     subtotal=Decimal("480"), coverage_start_date=cov_start,
                     coverage_end_date=cov_end)


def _make_db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    return engine, sessionmaker(bind=engine)


@pytest.fixture
def client():
    engine, TS = _make_db()
    db = TS()
    seed_bs_issues(db)
    _order(db, items=[_single("2026-01", 3)])
    _order(db, items=[_single("2026-04", 2)])
    _order(db, items=[_sub(date(2026, 1, 1), date(2026, 12, 31), 1)])   # 全年 → 全部 2026 期
    _order(db, items=[_sub(date(2026, 1, 1), date(2026, 6, 30), 2)])    # 半年 → 01,02~03,04,05,06
    _order(db, items=[OrderItem(publication=Publication.business_school,    # 无覆盖期 → unexpanded
                                fulfillment_type=FulfillmentType.subscription,
                                total_quantity=1, subtotal=Decimal("480"))])
    _order(db, status=OrderStatus.void, items=[_single("2026-01", 5)])  # 作废 → 不计
    db.commit()
    db.close()

    fake = User(id=1, username="t", password_hash="x", role=UserRole.admin)

    def og():
        d = TS()
        try:
            yield d
        finally:
            d.close()

    app.dependency_overrides[get_db] = og
    app.dependency_overrides[get_current_user] = lambda: fake
    c = TestClient(app)
    try:
        yield c
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)


def test_circulation_single_plus_subscription_with_gohe_dedup(client):
    d = client.get("/api/analytics/bs-circulation", params={"year": 2026}).json()
    by = {r["issue_label"]: r for r in d["rows"]}

    # 2026-01: 单期 3 + 订阅(全年1 + 半年2)=3 → 合计 6
    assert by["2026-01"]["single_issue_qty"] == 3
    assert by["2026-01"]["subscription_qty"] == 3
    assert by["2026-01"]["total_qty"] == 6

    # 2026-02~03 合刊：半年覆盖 1-6 月，跨 2、3 两月但**只计一次**（=全年1+半年2=3）
    assert by["2026-02~03"]["subscription_qty"] == 3
    assert by["2026-02~03"]["total_qty"] == 3

    # 2026-04：单期 2 + 订阅 3 = 5
    assert by["2026-04"]["single_issue_qty"] == 2
    assert by["2026-04"]["total_qty"] == 5

    # 2026-06：半年最后一期，订阅 3
    assert by["2026-06"]["subscription_qty"] == 3
    # 2026-07：超出半年，只剩全年 → 1
    assert by["2026-07"]["subscription_qty"] == 1
    # 2026-12：只全年 → 1
    assert by["2026-12"]["subscription_qty"] == 1
    assert by["2026-12"]["total_qty"] == 1

    # 缺覆盖期的订阅单独提示
    assert d["unexpanded_subscriptions"] == 1
    assert all(r["in_calendar"] for r in d["rows"])
    # grand totals
    assert d["grand_total_single"] == 5  # 3 + 2
    # 全年命中 11 期 ×1 + 半年命中 5 期 ×2 = 11 + 10 = 21
    assert d["grand_total_subscription"] == 21
    assert d["grand_total"] == 26


def test_subscription_covering_one_month_of_gohe(client):
    """订阅只覆盖 2 月或 3 月，也算命中 2~3 月合刊那一期。"""
    engine, TS = _make_db()
    db = TS()
    seed_bs_issues(db)
    _order(db, items=[_sub(date(2026, 3, 1), date(2026, 3, 31), 4)])  # 只覆盖 3 月
    db.commit()
    out = summarize_bs_circulation(db, year=2026)
    by = {r.issue_label: r for r in out.rows}
    assert by["2026-02~03"].subscription_qty == 4   # 覆盖 3 月 → 命中合刊
    assert by["2026-04"].subscription_qty == 0      # 没覆盖 4 月
    db.close()
    Base.metadata.drop_all(bind=engine)


def test_unlisted_issue_listed_but_subscription_not_expanded(client):
    """卖出过、但不在刊历的期 → 仍列出(in_calendar=False)，订阅展不到它。"""
    engine, TS = _make_db()
    db = TS()
    seed_bs_issues(db)
    _order(db, items=[_single("2099-09", 7)])  # 刊历里没有 2099
    db.commit()
    out = summarize_bs_circulation(db, year=2099)
    by = {r.issue_label: r for r in out.rows}
    assert by["2099-09"].single_issue_qty == 7
    assert by["2099-09"].in_calendar is False
    db.close()
    Base.metadata.drop_all(bind=engine)
