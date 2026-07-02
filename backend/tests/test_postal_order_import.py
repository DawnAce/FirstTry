"""邮局投递导入 · 单元测试（Task 2 起：投递单位透传；Task 3 起：读者明细导入）。

In-memory SQLite + Base.metadata.create_all，直接调 service 层，与 test_products_api 同风格。
"""

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    BillingType,
    FulfillmentTarget,
    FulfillmentType,
    Partner,
    PartnerType,
    Publication,
    PublicationFormat,
    ShippingChannel,
)
from app.schemas.order import FulfillmentTargetIn, OrderCreate, OrderItemIn
from app.services.order_service import create_imported_order


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    s = Session()
    try:
        yield s
    finally:
        s.close()


def test_target_carries_distribution_unit(db):
    """post_office 目标带上 distribution_unit_id → 落库正确（Task 2 核心）。"""
    unit = Partner(name="北京集订分送", partner_type=PartnerType.distribution)
    db.add(unit)
    db.flush()

    oc = OrderCreate(
        external_order_no="2026-4784",
        order_date=date(2026, 1, 1),
        payer_name="高占军",
        total_amount=Decimal("20"),
        paid_amount=Decimal("20"),
        items=[
            OrderItemIn(
                publication=Publication.cbj,
                publication_format=PublicationFormat.paper,
                fulfillment_type=FulfillmentType.subscription,
                billing_type=BillingType.paid,
                total_quantity=1,
                unit_price=Decimal("20"),
                subtotal=Decimal("20"),
                coverage_start_date=date(2026, 1, 1),
                coverage_end_date=date(2026, 1, 31),
                targets=[
                    FulfillmentTargetIn(
                        recipient_name="高占军",
                        recipient_address="上海市宝山区华灵路1900弄355号501室",
                        quantity=1,
                        shipping_channel=ShippingChannel.post_office,
                        distribution_unit_id=unit.id,
                    )
                ],
            )
        ],
    )
    create_imported_order(db, oc, order_code="PY26-0001")
    db.commit()

    tgt = db.query(FulfillmentTarget).one()
    assert tgt.distribution_unit_id == unit.id
    assert tgt.shipping_channel == ShippingChannel.post_office


def test_target_without_distribution_unit_is_null(db):
    """不填投递单位 → 留空（不推断），既有中通路径不受影响。"""
    oc = OrderCreate(
        external_order_no="2026-4801",
        order_date=date(2026, 1, 1),
        payer_name="郑天敏",
        total_amount=Decimal("20"),
        paid_amount=Decimal("20"),
        items=[
            OrderItemIn(
                publication=Publication.cbj,
                publication_format=PublicationFormat.paper,
                fulfillment_type=FulfillmentType.subscription,
                billing_type=BillingType.paid,
                total_quantity=1,
                unit_price=Decimal("20"),
                subtotal=Decimal("20"),
                coverage_start_date=date(2026, 1, 1),
                coverage_end_date=date(2026, 1, 31),
                targets=[
                    FulfillmentTargetIn(
                        recipient_name="郑天敏",
                        recipient_address="重庆市九龙坡区石坪桥街道骏逸新视界19栋25-6",
                        quantity=1,
                        shipping_channel=ShippingChannel.post_office,
                    )
                ],
            )
        ],
    )
    create_imported_order(db, oc, order_code="PY26-0002")
    db.commit()

    tgt = db.query(FulfillmentTarget).one()
    assert tgt.distribution_unit_id is None


# ---------------------------------------------------------------------------
# Task 3: 邮局读者明细导入（解析 → post_office 订单）
# ---------------------------------------------------------------------------

import io

import openpyxl

from app.models import DeliveryMethod, Order, OrderItem
from app.services.postal_import_service import (
    build_postal_preview,
    commit_import,
    preview_import,
)
from app.services.postal_order_import_parser import parse_postal_readers

_HEADERS = [
    "编号", "地区", "姓名", "联系电话", "省", "市", "区", "详细地址", "邮编", "年度",
    "产品名称", "起月日", "止月日", "份数", "金额", "渠道", "汇款名称", "汇款日期",
    "投递单位", "赠阅/关联", "备注",
]


def _make_workbook(rows: list[dict]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "邮局读者明细"
    ws.append(_HEADERS)
    for r in rows:
        ws.append([r.get(h, "") for h in _HEADERS])
    bio = io.BytesIO()
    wb.save(bio)
    return bio.getvalue()


def _seed_units(db, *names):
    ids = {}
    for n in names:
        p = Partner(name=n, partner_type=PartnerType.distribution)
        db.add(p)
        db.flush()
        ids[n] = p.id
    return ids


_ROWS = [
    {"编号": "4784", "地区": "上海", "姓名": "高占军", "联系电话": "13764491959",
     "省": "上海市", "市": "上海市", "区": "宝山区", "详细地址": "华灵路1900弄355号501室",
     "邮编": "201900", "年度": "2026年", "产品名称": "中国经营报", "起月日": "0101",
     "止月日": "0131", "份数": "1", "金额": "20", "渠道": "CBJ+小程序",
     "汇款名称": "发行部CBJ", "汇款日期": "20251025到账", "投递单位": "北京集订分送"},
    {"编号": "4837", "地区": "山东", "姓名": "孙琪", "联系电话": "18353360185",
     "省": "山东省", "市": "淄博市", "区": "临淄区", "详细地址": "齐兴路88号临淄农村商业银行",
     "邮编": "", "年度": "2026年", "产品名称": "中国经营报", "起月日": "0101",
     "止月日": "0531", "份数": "50", "金额": "5000", "渠道": "对公转账",
     "投递单位": "山东集订分送", "赠阅/关联": "潘蕊"},
    {"编号": "4801", "地区": "重庆", "姓名": "郑天敏", "联系电话": "18323045917",
     "省": "重庆市", "市": "重庆市", "区": "九龙坡区", "详细地址": "石坪桥街道骏逸新视界19栋25-6",
     "邮编": "400050", "年度": "2026年", "产品名称": "中国经营报", "起月日": "0101",
     "止月日": "0131", "份数": "1", "金额": "20", "渠道": "CBJ+小程序", "投递单位": ""},
]


def test_parse_and_preview_maps_rows(db):
    ids = _seed_units(db, "北京集订分送", "山东集订分送")
    parsed = parse_postal_readers(_make_workbook(_ROWS))
    assert len(parsed) == 3

    preview = build_postal_preview(db, parsed)
    assert preview.counts == {"total": 3, "import": 3, "duplicate": 0, "unresolved": 0}

    r0 = preview.rows[0]
    assert r0.external_order_no == "2026-4784"
    it = r0.order_create.items[0]
    assert it.delivery_method == DeliveryMethod.post_office
    assert it.coverage_start_date == date(2026, 1, 1)
    assert it.coverage_end_date == date(2026, 1, 31)
    assert it.targets[0].shipping_channel == ShippingChannel.post_office
    assert it.targets[0].distribution_unit_id == ids["北京集订分送"]

    # 对公 50 份：total_quantity=50, unit_price=100, subtotal=5000
    r1 = preview.rows[1]
    it1 = r1.order_create.items[0]
    assert it1.total_quantity == 50
    assert it1.subtotal == Decimal("5000")
    assert it1.unit_price == Decimal("100.00")
    assert it1.targets[0].distribution_unit_id == ids["山东集订分送"]

    # 投递单位空 → 留空（不推断）
    r2 = preview.rows[2]
    assert r2.order_create.items[0].targets[0].distribution_unit_id is None


def test_commit_creates_post_office_orders(db):
    _seed_units(db, "北京集订分送", "山东集订分送")
    out, sid = preview_import(db, _make_workbook(_ROWS))
    assert out["counts"]["import"] == 3
    result = commit_import(db, sid)
    assert result["created"] == 3

    order = db.query(Order).filter(Order.external_order_no == "2026-4784").one()
    assert order.source_platform == "CBJ+小程序"
    item = db.query(OrderItem).filter(OrderItem.order_id == order.id).one()
    assert item.delivery_method == DeliveryMethod.post_office
    assert item.coverage_start_date == date(2026, 1, 1)
    tgt = item.targets[0]
    assert tgt.shipping_channel == ShippingChannel.post_office
    assert tgt.distribution_unit_id is not None


def test_reimport_is_idempotent(db):
    _seed_units(db, "北京集订分送", "山东集订分送")
    wb = _make_workbook(_ROWS)
    _, sid = preview_import(db, wb)
    commit_import(db, sid)

    # 同一份表再次预览 → 全部判重
    out2, _ = preview_import(db, wb)
    assert out2["counts"] == {"total": 3, "import": 0, "duplicate": 3, "unresolved": 0}


def test_unresolved_product_and_year(db):
    bad = [
        {**_ROWS[0], "编号": "9001", "产品名称": "某不明刊物"},
        {**_ROWS[0], "编号": "9002", "年度": "年份缺失"},
    ]
    parsed = parse_postal_readers(_make_workbook(bad))
    preview = build_postal_preview(db, parsed)
    assert preview.counts["unresolved"] == 2
    assert preview.counts["import"] == 0


def test_bad_copies_and_inverted_dates_are_unresolved(db):
    """回归：份数=0 / 止月早于起月 的坏行标为待确认、不 500，其余行照常导入。"""
    _seed_units(db, "北京集订分送")
    bad = [
        {**_ROWS[0], "编号": "8001", "份数": "0"},                       # copies 0
        {**_ROWS[0], "编号": "8002", "起月日": "0501", "止月日": "0301"},  # end < start
        {**_ROWS[0], "编号": "8003"},                                    # 正常
    ]
    parsed = parse_postal_readers(_make_workbook(bad))
    preview = build_postal_preview(db, parsed)
    assert preview.counts["unresolved"] == 2
    assert preview.counts["import"] == 1


def test_postal_order_shows_in_customer_view(db):
    """回归：邮局订单（post_office）出现在客户管理聚合里（"订单展示"成立）。"""
    from app.services import customer_service

    _seed_units(db, "北京集订分送")
    _, sid = preview_import(db, _make_workbook([_ROWS[0]]))
    commit_import(db, sid)

    result = customer_service.list_customers(db)
    assert "高占军" in {r.recipient_name for r in result.rows}


