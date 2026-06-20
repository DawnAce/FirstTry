"""End-to-end: preview_import → commit_import creates real orders (Phase 3b-3b)."""

import io
from datetime import date

import pytest
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Order, OrderCommercialStatus, OrderEntryMethod, OrderItem, OrderStatus
from app.seeds.products import seed_products
from app.services.cbj_order_import_service import (
    BatchSettings,
    commit_import,
    preview_import,
)


HEADER = [
    "订单号", "产品名称", "数量", "原价", "付款金额", "支付方式", "发票",
    "地址", "备注", "下单时间", "支付时间", "订单状态",
]

ROWS = [
    ["EC-1", "《中国经营报》全年订阅-618促销活动X1,单价:199.0\n", 1, 199.0, 199.0,
     "微信", "", "冯志强,15103569527,晋城市某地址,048000", "",
     "2026-06-01 13:00:00.0", "2026-06-01 13:01:00.0", "卖家已发货"],
    ["EC-2", "《中国经营报》最新一期订阅X1,单价:5.0\n", 1, 5.0, 5.0,
     "微信", "", "李四,13800000000,某地址2", "",
     "2026-06-02 10:00:00.0", "", "待付款"],
    ["EC-3", "《中国经营报》和《商学院》全年订阅（8折优惠）X1,单价:576.0\n", 1, 576.0, 576.0,
     "微信", "", "侯女士,13311588321,北京某地址,100089", "",
     "2026-06-15 10:00:00.0", "2026-06-15 10:01:00.0", "已支付，卖家待发货"],
]


def _wb_bytes(rows):
    wb = Workbook()
    ws = wb.active
    ws.append(HEADER)
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    seed_products(session)
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


_SETTINGS = BatchSettings(
    mode="recent",
    post_office_start_month="2026-07",
    zto_start_month="2026-07",
    cutoff_date=date(2026, 6, 22),
)


def test_preview_then_commit_creates_orders(db):
    out, session_id = preview_import(db, _wb_bytes(ROWS), _SETTINGS)

    assert out["counts"] == {
        "total": 3, "import": 2, "skip_status": 1, "duplicate": 0, "unresolved": 0
    }
    assert out["can_commit"] is True

    result = commit_import(db, session_id)
    assert result["created"] == 2
    assert result["skipped_duplicates"] == 0

    orders = db.query(Order).order_by(Order.external_order_no).all()
    assert {o.external_order_no for o in orders} == {"EC-1", "EC-3"}
    for o in orders:
        assert o.entry_method == OrderEntryMethod.excel_import
        assert o.status == OrderStatus.active
        assert o.order_code and o.order_code.startswith("ORD-2026-")

    ec1 = next(o for o in orders if o.external_order_no == "EC-1")
    assert ec1.commercial_status == OrderCommercialStatus.shipped
    assert len(db.query(OrderItem).filter(OrderItem.order_id == ec1.id).all()) == 1

    ec3 = next(o for o in orders if o.external_order_no == "EC-3")
    # bundle fanned into two items
    assert len(db.query(OrderItem).filter(OrderItem.order_id == ec3.id).all()) == 2


def test_commit_re_skips_now_duplicate(db):
    # First import.
    out, sid = preview_import(db, _wb_bytes(ROWS[:1]), _SETTINGS)
    assert commit_import(db, sid)["created"] == 1
    # Preview the same file again, then commit → already exists, skipped.
    out2, sid2 = preview_import(db, _wb_bytes(ROWS[:1]), _SETTINGS)
    # preview already flags it duplicate
    assert out2["counts"]["duplicate"] == 1 and out2["counts"]["import"] == 0


def test_commit_expired_session_raises(db):
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        commit_import(db, "no-such-session")
    assert exc.value.status_code == 400
