"""邮局投递导入 · 单元测试（重构后：读者明细 → 投递记录 PostalDelivery，不造订单）。

In-memory SQLite + Base.metadata.create_all，直接调 service 层，与 test_products_api 同风格。
"""

import io
from datetime import date
from decimal import Decimal

import openpyxl
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    BillingType,
    FulfillmentTarget,
    FulfillmentType,
    Order,
    Partner,
    PartnerType,
    PostalDelivery,
    PostalDeliverySourceType,
    Publication,
    PublicationFormat,
    ShippingChannel,
)
from app.schemas.order import FulfillmentTargetIn, OrderCreate, OrderItemIn
from app.services.order_service import create_imported_order
from app.services.postal_delivery_import_service import (
    build_postal_preview,
    commit_import,
    preview_import,
)
from app.services.postal_order_import_parser import parse_postal_readers


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


# ---------------------------------------------------------------------------
# 订单链路仍保留把 distribution_unit_id 写进 FulfillmentTarget 的能力（供真实订单用）。
# ---------------------------------------------------------------------------

def test_target_carries_distribution_unit(db):
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


# ---------------------------------------------------------------------------
# 读者明细导入 → 投递记录（PostalDelivery），不造订单。
# ---------------------------------------------------------------------------

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
    assert r0.delivery_no == "4784"
    assert r0.year == 2026
    d0 = r0.data
    assert d0["coverage_start_date"] == "2026-01-01"
    assert d0["coverage_end_date"] == "2026-01-31"
    assert d0["copies"] == 1
    assert d0["distribution_unit_id"] == ids["北京集订分送"]
    assert d0["source_channel"] == "CBJ+小程序"
    # 读者明细无平台订单号 → 不挂订单。
    assert d0["order_id"] is None
    assert d0["external_order_no"] is None

    # 对公 50 份
    r1 = preview.rows[1]
    assert r1.data["copies"] == 50
    assert r1.data["amount"] == "5000"
    assert r1.data["distribution_unit_id"] == ids["山东集订分送"]

    # 投递单位空 → 留空（不推断）
    assert preview.rows[2].data["distribution_unit_id"] is None


def test_commit_creates_delivery_records_not_orders(db):
    _seed_units(db, "北京集订分送", "山东集订分送")
    out, sid = preview_import(db, _make_workbook(_ROWS))
    assert out["counts"]["import"] == 3
    result = commit_import(db, sid)
    assert result["created"] == 3

    # 不造任何订单。
    assert db.query(Order).count() == 0

    rec = db.query(PostalDelivery).filter_by(year=2026, delivery_no="4784").one()
    assert rec.recipient_name == "高占军"
    assert rec.source_channel == "CBJ+小程序"
    assert rec.coverage_start_date == date(2026, 1, 1)
    assert rec.distribution_unit_id is not None
    assert rec.order_id is None
    assert rec.source_type == PostalDeliverySourceType.historical_import


def test_reimport_is_idempotent(db):
    _seed_units(db, "北京集订分送", "山东集订分送")
    wb = _make_workbook(_ROWS)
    _, sid = preview_import(db, wb)
    commit_import(db, sid)

    # 同一份表再次预览 → 全部判重（按 年度+编号）。
    out2, _ = preview_import(db, wb)
    assert out2["counts"] == {"total": 3, "import": 0, "duplicate": 3, "unresolved": 0}


def test_unrecognized_product_is_kept_year_missing_unresolved(db):
    """产品认不出 → 留原文照常导入（邮局纯投递）；年度缺失 → 待确认。"""
    _seed_units(db, "北京集订分送")
    bad = [
        {**_ROWS[0], "编号": "9001", "产品名称": "某不明刊物"},  # 产品认不出 → 照常导入
        {**_ROWS[0], "编号": "9002", "年度": "年份缺失"},         # 年度缺失 → unresolved
    ]
    parsed = parse_postal_readers(_make_workbook(bad))
    preview = build_postal_preview(db, parsed)
    assert preview.counts["unresolved"] == 1
    assert preview.counts["import"] == 1
    imp = preview.by_decision("import")[0]
    assert imp.data["product"] == "某不明刊物"


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


def test_postal_delivery_not_in_customer_view(db):
    """反向断言：投递记录不造订单 → 不进客户管理聚合（邮局是投递数据、不是订单）。"""
    from app.services import customer_service

    _seed_units(db, "北京集订分送")
    _, sid = preview_import(db, _make_workbook([_ROWS[0]]))
    commit_import(db, sid)

    assert db.query(Order).count() == 0
    result = customer_service.list_customers(db)
    assert "高占军" not in {r.recipient_name for r in result.rows}


def test_list_deliveries_filters(db):
    """投递名册列表：年度 / 起投月 / 渠道 / 搜索 筛选。"""
    from app.services.postal_delivery_service import list_deliveries

    _seed_units(db, "北京集订分送", "山东集订分送")
    _, sid = preview_import(db, _make_workbook(_ROWS))
    commit_import(db, sid)

    _, total = list_deliveries(db, year=2026)
    assert total == 3

    rows, total = list_deliveries(db, search="高占军")
    assert total == 1 and rows[0].delivery_no == "4784"

    _, total = list_deliveries(db, year=2026, month=1)
    assert total == 3  # 三条都 1 月起投

    rows, total = list_deliveries(db, channel="对公")
    assert total == 1 and rows[0].recipient_name == "孙琪"

    _, total = list_deliveries(db, distribution_unit_id=None, year=2025)
    assert total == 0  # 无 2025 年度记录
