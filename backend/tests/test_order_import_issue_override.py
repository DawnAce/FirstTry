"""Tests for commit_import 的往期单选填补期号（issue_overrides）。

直接构造 preview→commit 的 cache session（跳过 Excel 解析），聚焦 override
逻辑本身：只作用于单期且无期号的行、不匹配单号忽略、订阅/已有期号不动、
无 override 时行为不变。
"""

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Order
from app.models.order_item import OrderItem
from app.order_import_cache import save_order_import_session
from app.services.cbj_order_import_service import commit_import


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


def _single_issue_row(ext, *, issue_number=None):
    """A commit row for a 往期 single-issue order with a blank (or given) 期号."""
    return {
        "order_create": {
            "order_date": "2026-05-01",
            "external_order_no": ext,
            "payer_name": "客服往期单",
            "total_amount": "10",
            "paid_amount": "10",
            "items": [
                {
                    "publication": "cbj",
                    "fulfillment_type": "single_issue",
                    "billing_type": "paid",
                    "issue_number": issue_number,
                    "total_quantity": 1,
                    "unit_price": "10",
                    "subtotal": "10",
                    "targets": [],
                }
            ],
        },
        "commercial_status": "shipped",
        "source_status_raw": "交易成功",
        "is_historical_archive": False,
    }


def _subscription_row(ext):
    return {
        "order_create": {
            "order_date": "2026-05-01",
            "external_order_no": ext,
            "payer_name": "订阅单",
            "total_amount": "360",
            "paid_amount": "360",
            "items": [
                {
                    "publication": "cbj",
                    "fulfillment_type": "subscription",
                    "billing_type": "paid",
                    "subscription_term": "one_year",
                    "coverage_start_date": "2026-06-01",
                    "coverage_end_date": "2027-05-31",
                    "issue_number": None,
                    "total_quantity": 1,
                    "unit_price": "360",
                    "subtotal": "360",
                    "targets": [],
                }
            ],
        },
        "commercial_status": "shipped",
        "source_status_raw": "交易成功",
        "is_historical_archive": False,
    }


def _issue_number_of(db, ext):
    order = db.query(Order).filter(Order.external_order_no == ext).first()
    assert order is not None
    item = db.query(OrderItem).filter(OrderItem.order_id == order.id).first()
    return item.issue_number


def test_override_fills_blank_single_issue(db):
    sid = save_order_import_session({"mode": "recent", "rows": [_single_issue_row("EC-PAST-1")]})
    res = commit_import(db, sid, issue_overrides={"EC-PAST-1": 2650})
    assert res["created"] == 1
    assert _issue_number_of(db, "EC-PAST-1") == 2650


def test_no_override_leaves_issue_blank(db):
    """现状回归：不带 override，往期单期号照旧留空、照常导入。"""
    sid = save_order_import_session({"mode": "recent", "rows": [_single_issue_row("EC-PAST-2")]})
    res = commit_import(db, sid)
    assert res["created"] == 1
    assert _issue_number_of(db, "EC-PAST-2") is None


def test_override_for_unknown_order_is_ignored(db):
    sid = save_order_import_session({"mode": "recent", "rows": [_single_issue_row("EC-PAST-3")]})
    # override 指向本批不存在的单号 → 忽略、不报错、该单照常导入（期号仍空）
    res = commit_import(db, sid, issue_overrides={"NOT-IN-BATCH": 999})
    assert res["created"] == 1
    assert _issue_number_of(db, "EC-PAST-3") is None


def test_override_does_not_touch_subscription(db):
    sid = save_order_import_session({"mode": "recent", "rows": [_subscription_row("EC-SUB-1")]})
    # 即便误把 override 指向订阅单，也不改（只作用 single_issue 且空期号）
    res = commit_import(db, sid, issue_overrides={"EC-SUB-1": 2650})
    assert res["created"] == 1
    assert _issue_number_of(db, "EC-SUB-1") is None


def test_override_does_not_overwrite_existing_issue_number(db):
    sid = save_order_import_session(
        {"mode": "recent", "rows": [_single_issue_row("EC-PAST-4", issue_number=2600)]}
    )
    # 已有期号的单期不被 override 覆盖
    res = commit_import(db, sid, issue_overrides={"EC-PAST-4": 2650})
    assert res["created"] == 1
    assert _issue_number_of(db, "EC-PAST-4") == 2600
