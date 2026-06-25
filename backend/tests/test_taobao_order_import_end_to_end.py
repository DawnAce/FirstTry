"""End-to-end 淘宝 import: auto-detect → preview_import → commit_import.

Exercises the SHARED downstream (resolver / status / coverage / dedup / order
create) through the Taobao parser, and asserts the platform-specific bits:
source_platform routing, SKU-driven delivery (邮局 vs 中通), 商学院 issue labels,
and the manual-topup warnings.
"""

import io
from datetime import date

import pytest
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Order, OrderCommercialStatus, OrderEntryMethod, OrderItem, OrderStatus
from app.models.order_item import DeliveryMethod, FulfillmentType, Publication
from app.seeds.products import seed_products
from app.services.cbj_order_import_service import (
    BatchSettings,
    commit_import,
    preview_import,
)

HEADER = [
    "订单编号", "支付单号", "买家应付货款", "买家应付邮费", "总金额",
    "买家实付金额", "订单状态", "收货地址", "运送方式", "订单创建时间",
    "商品标题", "宝贝种类", "物流单号", "物流公司", "备注标签", "商家备注",
    "宝贝总数量", "开票信息", "手机订单", "商品属性SKU", "发货时间",
]

ADDR = "江苏省 南京市 建邺区 沙洲街道****"
RETAIL_CBJ = "单期零售《中国经营报》刊社直发正品保证商业财经经济时政新闻热点资讯报刊"
SUB_CBJ = "全年49期中国经营报订阅刊社直发财经经济时政新闻热点资讯报刊"
BS_SINGLE = "【2026单期】《商学院》杂志订阅商业财经经济时政新闻热点资讯"
BS_FLOW = "一期一发快递发货《商学院》杂志订阅商业财经经济热点资讯期刊"


def _row(order_no, *, goods, postage, list_total, paid, status, title, sku,
         total_qty="1", note="", order_time="2026-05-10 10:00:00"):
    return [
        order_no, "PAY", goods, postage, list_total, paid, status, ADDR, "快递",
        order_time, title, "1", "73600316247086", "中通快递", "", note,
        total_qty, "", "手机订单", sku, "2026-05-11 09:00:00",
    ]


ROWS = [
    # 商学院单期（分册名带月份）→ issue_label
    _row("T-BS-MONTH", goods="34.00", postage="0.00", list_total="40.00",
         paid="34.00", status="交易成功", title=BS_SINGLE, sku="分册名:2026年5月刊"),
    # 全年订阅·邮局（SKU 区分投递）→ post_office
    _row("T-SUB-POST", goods="240.00", postage="0.00", list_total="240.00",
         paid="240.00", status="交易成功", title=SUB_CBJ,
         sku="分册名:全年-邮局-周投[（投信报箱，无物流查询）]"),
    # 全年订阅·快递月寄 → zto_mf
    _row("T-SUB-ZTO", goods="211.00", postage="0.00", list_total="240.00",
         paid="211.00", status="交易成功", title=SUB_CBJ,
         sku="分册名:全年-快递-月寄[（月底统一快递当月报纸）]"),
    # 单期零售《中国经营报》→ 往期 warn
    _row("T-RETAIL", goods="4.25", postage="5.00", list_total="5.00",
         paid="9.25", status="交易成功", title=RETAIL_CBJ, sku=""),
    # 商学院季度（一期一发）→ BS-SUB-QTR-ZTO
    _row("T-QTR", goods="315.00", postage="0.00", list_total="360.00",
         paid="315.00", status="交易成功", title=BS_FLOW,
         sku="分册名:季度订阅[（自由起订时间，下单备注）]"),
    # 多商品 商学院单期（无分册名）→ import + 请补期次 warn
    _row("T-MULTI", goods="80.00", postage="0.00", list_total="80.00",
         paid="80.00", status="交易成功", title=f"{BS_SINGLE},{BS_SINGLE}",
         sku="", total_qty="2"),
    # 交易关闭 → skip
    _row("T-CLOSED", goods="40.00", postage="0.00", list_total="40.00",
         paid="0.00", status="交易关闭", title=BS_SINGLE, sku="分册名:2026年4月刊"),
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


SETTINGS = BatchSettings(
    mode="recent",
    post_office_start_month="2026-07",
    zto_start_month="2026-07",
    cutoff_date=date(2026, 6, 22),
)


def _rows_by_no(out):
    return {r["external_order_no"]: r for r in out["rows"]}


def test_taobao_preview_decisions(db):
    out, _ = preview_import(db, _wb_bytes(ROWS), SETTINGS)
    assert out["counts"] == {
        "total": 7, "import": 6, "skip_status": 1, "duplicate": 0, "unresolved": 0
    }
    rows = _rows_by_no(out)

    # 商学院单期带分册名 → issue_label
    bs = rows["T-BS-MONTH"]
    assert bs["decision"] == "import"
    assert bs["items"][0]["publication"] == "business_school"
    assert bs["items"][0]["issue_label"] == "2026-05"

    # SKU 区分投递：邮局 vs 中通
    assert rows["T-SUB-POST"]["items"][0]["delivery_method"] == "post_office"
    assert rows["T-SUB-ZTO"]["items"][0]["delivery_method"] == "zto_mf"

    # 单期零售《中国经营报》→ 往期 warn
    assert any("往期单" in w for w in rows["T-RETAIL"]["warnings"])

    # 商学院季度 → zto_mf subscription，覆盖期留空（自由起订）
    qtr = rows["T-QTR"]["items"][0]
    assert qtr["publication"] == "business_school"
    assert qtr["delivery_method"] == "zto_mf"
    assert qtr["coverage_start_date"] is None

    # 多商品商学院单期：2 条明细 + 请补期次 warn，期次留空
    multi = rows["T-MULTI"]
    assert multi["decision"] == "import"
    assert len(multi["items"]) == 2
    assert all(it["issue_label"] is None for it in multi["items"])
    assert any("请补该单期次" in w for w in multi["warnings"])


def test_taobao_commit_sets_platform_and_delivery(db):
    out, session_id = preview_import(db, _wb_bytes(ROWS), SETTINGS)
    result = commit_import(db, session_id)
    assert result["created"] == 6

    orders = {o.external_order_no: o for o in db.query(Order).all()}
    assert set(orders) == {
        "T-BS-MONTH", "T-SUB-POST", "T-SUB-ZTO", "T-RETAIL", "T-QTR", "T-MULTI"
    }
    for o in orders.values():
        assert o.entry_method == OrderEntryMethod.excel_import
        assert o.status == OrderStatus.active
        assert o.source_platform == "淘宝"
        assert o.source_store == "中国经营报发行部"
        assert o.commercial_status == OrderCommercialStatus.shipped
        # recipient is desensitized → payer left as the placeholder, not invented
        assert o.payer_name == "(未填写)"

    # 全年·邮局 subscription got a computed coverage window; 季度 (custom) did not
    post = orders["T-SUB-POST"]
    post_item = db.query(OrderItem).filter(OrderItem.order_id == post.id).one()
    assert post_item.delivery_method == DeliveryMethod.post_office
    assert post_item.fulfillment_type == FulfillmentType.subscription
    assert post_item.coverage_start_date == date(2026, 7, 1)

    qtr = orders["T-QTR"]
    qtr_item = db.query(OrderItem).filter(OrderItem.order_id == qtr.id).one()
    assert qtr_item.publication == Publication.business_school
    assert qtr_item.delivery_method == DeliveryMethod.zto_mf
    assert qtr_item.coverage_start_date is None  # 自由起订 → operator fills later


def test_taobao_dedup_on_second_commit(db):
    out, sid = preview_import(db, _wb_bytes(ROWS[:1]), SETTINGS)
    assert commit_import(db, sid)["created"] == 1
    out2, sid2 = preview_import(db, _wb_bytes(ROWS[:1]), SETTINGS)
    assert out2["counts"]["duplicate"] == 1 and out2["counts"]["import"] == 0


def test_unrecognized_file_raises_clear_error(db):
    wb = Workbook()
    ws = wb.active
    ws.append(["甲", "乙", "丙"])  # neither CBJ nor Taobao headers
    ws.append([1, 2, 3])
    buf = io.BytesIO()
    wb.save(buf)
    with pytest.raises(ValueError, match="无法识别"):
        preview_import(db, buf.getvalue(), SETTINGS)
