"""Tests for commit_import 的选填补录（issue_overrides / issue_label_overrides）。

直接构造 preview→commit 的 cache session（跳过 Excel 解析），聚焦 override 逻辑本身。
补录键为 "订单号#item序号" —— 一单可含多个单期 SKU、各是不同期，补录须精确到 item，
不能整单套一个值。重点覆盖：按 item 定位、多 item 不串、订阅/已填不动、越界/非法忽略、
无 override 回归。
"""

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


def _cbj_single_item(*, issue_number=None):
    return {
        "publication": "cbj",
        "fulfillment_type": "single_issue",
        "billing_type": "paid",
        "issue_number": issue_number,
        "total_quantity": 1,
        "unit_price": "10",
        "subtotal": "10",
        "targets": [],
    }


def _bs_single_item(*, issue_label=None):
    return {
        "publication": "business_school",
        "fulfillment_type": "single_issue",
        "billing_type": "paid",
        "issue_label": issue_label,
        "total_quantity": 1,
        "unit_price": "34",
        "subtotal": "34",
        "targets": [],
    }


def _sub_item():
    return {
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


def _row(ext, items, *, payer="导入单"):
    return {
        "order_create": {
            "order_date": "2026-05-01",
            "external_order_no": ext,
            "payer_name": payer,
            "total_amount": "10",
            "paid_amount": "10",
            "items": items,
        },
        "commercial_status": "shipped",
        "source_status_raw": "交易成功",
        "is_historical_archive": False,
    }


def _put(rows):
    return save_order_import_session({"mode": "recent", "rows": rows})


def _items_of(db, ext):
    """该订单的 items，按 id 升序（= 落库顺序 = 预览/override item 序号）。"""
    order = db.query(Order).filter(Order.external_order_no == ext).first()
    assert order is not None
    return db.query(OrderItem).filter(OrderItem.order_id == order.id).order_by(OrderItem.id).all()


# --- 中国经营报往期单：issue_number（按 item 序号） -----------------------------


def test_override_fills_blank_single_issue(db):
    sid = _put([_row("EC-PAST-1", [_cbj_single_item()])])
    res = commit_import(db, sid, issue_overrides={"EC-PAST-1#0": 2650})
    assert res["created"] == 1
    assert _items_of(db, "EC-PAST-1")[0].issue_number == 2650


def test_multi_item_number_overrides_do_not_cross(db):
    """一单两个空单期 item → 各填不同期号，落库不串（核心用例）。"""
    sid = _put([_row("EC-MULTI-1", [_cbj_single_item(), _cbj_single_item()])])
    res = commit_import(db, sid, issue_overrides={"EC-MULTI-1#0": 2650, "EC-MULTI-1#1": 2648})
    assert res["created"] == 1
    items = _items_of(db, "EC-MULTI-1")
    assert [it.issue_number for it in items] == [2650, 2648]


def test_number_override_only_hits_named_index(db):
    """只补 #1，#0 保持空。"""
    sid = _put([_row("EC-MULTI-2", [_cbj_single_item(), _cbj_single_item()])])
    commit_import(db, sid, issue_overrides={"EC-MULTI-2#1": 2648})
    items = _items_of(db, "EC-MULTI-2")
    assert [it.issue_number for it in items] == [None, 2648]


def test_no_override_leaves_issue_blank(db):
    """现状回归：不带 override，往期单期号照旧留空、照常导入。"""
    sid = _put([_row("EC-PAST-2", [_cbj_single_item()])])
    res = commit_import(db, sid)
    assert res["created"] == 1
    assert _items_of(db, "EC-PAST-2")[0].issue_number is None


def test_override_for_unknown_order_is_ignored(db):
    sid = _put([_row("EC-PAST-3", [_cbj_single_item()])])
    res = commit_import(db, sid, issue_overrides={"NOT-IN-BATCH#0": 999})
    assert res["created"] == 1
    assert _items_of(db, "EC-PAST-3")[0].issue_number is None


def test_override_out_of_range_index_ignored(db):
    sid = _put([_row("EC-PAST-3b", [_cbj_single_item()])])
    res = commit_import(db, sid, issue_overrides={"EC-PAST-3b#9": 999})
    assert res["created"] == 1
    assert _items_of(db, "EC-PAST-3b")[0].issue_number is None


def test_override_does_not_touch_subscription(db):
    sid = _put([_row("EC-SUB-1", [_sub_item()])])
    res = commit_import(db, sid, issue_overrides={"EC-SUB-1#0": 2650})
    assert res["created"] == 1
    assert _items_of(db, "EC-SUB-1")[0].issue_number is None


def test_override_does_not_overwrite_existing_issue_number(db):
    sid = _put([_row("EC-PAST-4", [_cbj_single_item(issue_number=2600)])])
    res = commit_import(db, sid, issue_overrides={"EC-PAST-4#0": 2650})
    assert res["created"] == 1
    assert _items_of(db, "EC-PAST-4")[0].issue_number == 2600


# --- 商学院单期：issue_label（按 item 序号） -----------------------------------


def test_label_override_fills_blank_bs_single_issue(db):
    sid = _put([_row("EC-BS-1", [_bs_single_item()])])
    res = commit_import(db, sid, issue_label_overrides={"EC-BS-1#0": "2026-06"})
    assert res["created"] == 1
    assert _items_of(db, "EC-BS-1")[0].issue_label == "2026-06"


def test_multi_item_label_overrides_do_not_cross(db):
    """一单 3 个空商学院单期 → 各填不同月份，落库不串（对应用户截图 5×¥34 的场景）。"""
    sid = _put([_row("EC-BS-MULTI", [_bs_single_item(), _bs_single_item(), _bs_single_item()])])
    res = commit_import(
        db,
        sid,
        issue_label_overrides={"EC-BS-MULTI#0": "2026-02", "EC-BS-MULTI#1": "2026-03~04", "EC-BS-MULTI#2": "2026-05"},
    )
    assert res["created"] == 1
    items = _items_of(db, "EC-BS-MULTI")
    assert [it.issue_label for it in items] == ["2026-02", "2026-03~04", "2026-05"]


def test_label_override_ignores_malformed(db):
    sid = _put([_row("EC-BS-3", [_bs_single_item()])])
    res = commit_import(db, sid, issue_label_overrides={"EC-BS-3#0": "2026年6月"})
    assert res["created"] == 1
    assert _items_of(db, "EC-BS-3")[0].issue_label is None


def test_label_override_does_not_overwrite_existing(db):
    sid = _put([_row("EC-BS-4", [_bs_single_item(issue_label="2026-05")])])
    res = commit_import(db, sid, issue_label_overrides={"EC-BS-4#0": "2026-06"})
    assert res["created"] == 1
    assert _items_of(db, "EC-BS-4")[0].issue_label == "2026-05"


def test_label_override_does_not_touch_cbj_row(db):
    """label override 只作用商学院 item；中国经营报 item 不受影响。"""
    sid = _put([_row("EC-PAST-5", [_cbj_single_item()])])
    res = commit_import(db, sid, issue_label_overrides={"EC-PAST-5#0": "2026-06"})
    assert res["created"] == 1
    assert _items_of(db, "EC-PAST-5")[0].issue_number is None
    assert _items_of(db, "EC-PAST-5")[0].issue_label is None


def test_no_label_override_leaves_label_blank(db):
    sid = _put([_row("EC-BS-5", [_bs_single_item()])])
    res = commit_import(db, sid)
    assert res["created"] == 1
    assert _items_of(db, "EC-BS-5")[0].issue_label is None


def test_mixed_number_and_label_in_one_order(db):
    """一单里既有中国经营报往期单 item 又有商学院单期 item → 两套 override 各归各。"""
    sid = _put([_row("EC-MIX", [_cbj_single_item(), _bs_single_item()])])
    res = commit_import(
        db,
        sid,
        issue_overrides={"EC-MIX#0": 2650},
        issue_label_overrides={"EC-MIX#1": "2026-06"},
    )
    assert res["created"] == 1
    items = _items_of(db, "EC-MIX")
    assert items[0].issue_number == 2650 and items[0].issue_label is None
    assert items[1].issue_label == "2026-06" and items[1].issue_number is None
