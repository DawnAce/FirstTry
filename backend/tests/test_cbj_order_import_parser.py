"""Tests for the CBJ 小程序 order-export parser.

Builds a workbook mirroring the real export structure (multi-line 产品名称,
combined 地址, X0 promo lines, 运费补拍 lines) and asserts clean extraction.
"""

import io
from datetime import date, datetime
from decimal import Decimal

import pytest
from openpyxl import Workbook

from app.services.cbj_order_import_parser import (
    parse_address,
    parse_cbj_orders,
    parse_product_field,
)


HEADER = [
    "订单号", "产品名称", "数量", "原价", "付款金额", "支付方式", "发票",
    "地址", "备注", "下单时间", "支付时间", "订单状态",
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


SAMPLE_ROWS = [
    [
        "2026060113371095543144",
        "《中国经营报》全年订阅-618促销活动X1,单价:199.0\n2026年1月刊《AI赋能，乡村新生》X0,单价:40.0\n",
        1, 199.0, 199.0, "微信", "",
        "冯志强,15103569527,晋城市城区西上庄办事处北闫庄星湖湾3#804,048000", "",
        "2026-06-01 13:37:10.0", "2026-06-01 13:37:50.0", "卖家已发货",
    ],
    [
        "2026060716023324683158",
        "《中国经营报》全年订阅-618促销活动X1,单价:199.0\n《中国经营报》运费补拍（邮局转中通）X50,单价:3.0\n",
        51, 349.0, 349.0, "微信", "",
        "陈绮琪,13922323387,广东省广州市番禺区市桥街道光明北路康乐园五街三座501", "",
        "2026-06-07 16:02:33.0", "2026-06-07 16:04:40.0", "卖家已发货",
    ],
    [
        "2026061510000000000999",
        "《中国经营报》和《商学院》全年订阅（8折优惠）X1,单价:576.0\n",
        1, 576.0, 576.0, "微信", "",
        "侯女士,13311588321,北京市海淀区万寿路街道万寿园小区4号楼1506,100089", "",
        "2026-06-15 10:00:00.0", "2026-06-15 10:01:00.0", "已支付，卖家待发货",
    ],
]


def test_parse_product_field_drops_x0_keeps_real():
    lines = parse_product_field(
        "《中国经营报》全年订阅-618促销活动X1,单价:199.0\n2026年1月刊《AI赋能，乡村新生》X0,单价:40.0\n"
    )
    assert len(lines) == 1
    assert lines[0].name == "《中国经营报》全年订阅-618促销活动"
    assert lines[0].quantity == 1
    assert lines[0].unit_price == Decimal("199.0")
    assert lines[0].is_shipping is False


def test_parse_product_field_flags_shipping_and_zto():
    lines = parse_product_field(
        "《中国经营报》全年订阅-618促销活动X1,单价:199.0\n《中国经营报》运费补拍（邮局转中通）X50,单价:3.0\n"
    )
    assert len(lines) == 2
    sub, freight = lines
    assert sub.is_shipping is False
    assert freight.is_shipping is True
    assert freight.mentions_zto is True
    assert freight.quantity == 50


def test_parse_product_field_flags_kuaidifei_as_shipping():
    # 「全年快递费用」也是运费类（名里无"运费"），应识别为运费行
    lines = parse_product_field("《中国经营报》全年快递费用X1,单价:150.0\n")
    assert len(lines) == 1 and lines[0].is_shipping is True


def test_parse_address_splits_name_phone_addr_postal():
    name, phone, addr, postal = parse_address(
        "冯志强,15103569527,晋城市城区西上庄办事处北闫庄星湖湾3#804,048000"
    )
    assert name == "冯志强"
    assert phone == "15103569527"
    assert addr == "晋城市城区西上庄办事处北闫庄星湖湾3#804"
    assert postal == "048000"


def test_parse_address_without_postal():
    name, phone, addr, postal = parse_address("许生,13078145892,广东省佛山市禅城区华远东路")
    assert (name, phone, addr, postal) == ("许生", "13078145892", "广东省佛山市禅城区华远东路", None)


def test_parse_cbj_orders_end_to_end():
    orders = parse_cbj_orders(_wb_bytes(SAMPLE_ROWS))
    assert len(orders) == 3

    o1 = orders[0]
    assert o1.external_order_no == "2026060113371095543144"
    assert o1.status_raw == "卖家已发货"
    assert o1.paid_amount == Decimal("199.0")
    assert o1.recipient_name == "冯志强"
    assert o1.recipient_phone == "15103569527"
    assert o1.recipient_postal_code == "048000"
    assert o1.order_date == date(2026, 6, 1)
    assert o1.payment_time == datetime(2026, 6, 1, 13, 37, 50)
    assert len(o1.product_lines) == 1  # X0 line dropped

    o2 = orders[1]
    assert len(o2.product_lines) == 2
    assert any(pl.is_shipping and pl.mentions_zto for pl in o2.product_lines)

    o3 = orders[2]
    assert o3.status_raw == "已支付，卖家待发货"
    assert "商学院" in o3.product_lines[0].name


def test_parse_cbj_orders_rejects_non_cbj_workbook():
    wb = Workbook()
    wb.active.append(["foo", "bar"])
    buf = io.BytesIO()
    wb.save(buf)
    with pytest.raises(ValueError):
        parse_cbj_orders(buf.getvalue())


def test_parse_cbj_orders_skips_blank_trailing_rows():
    rows = SAMPLE_ROWS + [[None] * 12, ["", "", "", "", "", "", "", "", "", "", "", ""]]
    orders = parse_cbj_orders(_wb_bytes(rows))
    assert len(orders) == 3
