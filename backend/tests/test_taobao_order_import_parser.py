"""Unit tests for the 淘宝 order-export parser (column mapping → ParsedOrder)."""

import io
from decimal import Decimal

from openpyxl import Workbook

from app.services.cbj_order_import_parser import is_cbj_export, parse_cbj_orders
from app.services.taobao_order_import_parser import (
    is_taobao_export,
    parse_taobao_orders,
)

# The real export's 21 columns, in order.
HEADER = [
    "订单编号", "支付单号", "买家应付货款", "买家应付邮费", "总金额",
    "买家实付金额", "订单状态", "收货地址", "运送方式", "订单创建时间",
    "商品标题", "宝贝种类", "物流单号", "物流公司", "备注标签", "商家备注",
    "宝贝总数量", "开票信息", "手机订单", "商品属性SKU", "发货时间",
]


def _row(
    *,
    order_no="5118609024991031607",
    goods="34.00",
    postage="0.00",
    list_total="40.00",
    paid="34.00",
    status="交易成功",
    address="江苏省 南京市 建邺区 沙洲街道****",
    order_time="2026-05-31 14:16:18",
    title="【2026单期】《商学院》杂志订阅商业财经经济时政新闻热点资讯",
    kinds="1",
    tracking="73600316247086",
    logistics="中通快递",
    note="",
    total_qty="1",
    invoice="",
    sku="分册名:2026年5月刊",
    ship_time="2026-05-31 14:22:47",
):
    return [
        order_no, "PAY1", goods, postage, list_total, paid, status, address,
        "快递", order_time, title, kinds, tracking, logistics, "", note,
        total_qty, invoice, "手机订单", sku, ship_time,
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


def _cbj_wb_bytes():
    wb = Workbook()
    ws = wb.active
    ws.append(["订单号", "产品名称", "数量", "原价", "付款金额", "支付方式",
               "发票", "地址", "备注", "下单时间", "支付时间", "订单状态"])
    ws.append(["EC-1", "《中国经营报》最新一期订阅X1,单价:5.0\n", 1, 5.0, 5.0,
               "微信", "", "张三,13800000000,北京某地址", "",
               "2026-06-01 13:00:00", "2026-06-01 13:01:00", "卖家已发货"])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_sniffer_distinguishes_platforms():
    taobao = _wb_bytes([_row()])
    cbj = _cbj_wb_bytes()
    # Sniffers are disjoint: each recognizes only its own format.
    assert is_taobao_export(taobao) is True
    assert is_taobao_export(cbj) is False
    assert is_cbj_export(cbj) is True
    assert is_cbj_export(taobao) is False
    # ...and the CBJ parser still rejects a Taobao file (disjoint headers).
    import pytest

    with pytest.raises(ValueError):
        parse_cbj_orders(taobao)


def test_basic_column_mapping():
    [po] = parse_taobao_orders(_wb_bytes([_row()]))
    assert po.external_order_no == "5118609024991031607"
    assert po.status_raw == "交易成功"
    assert po.paid_amount == Decimal("34.00")
    assert po.order_date.isoformat() == "2026-05-31"
    assert po.payment_time is not None  # 创建时间 used as the payment-time proxy
    assert po.payment_method_raw == "支付宝"  # Taobao → alipay downstream
    # recipient is desensitized: name/phone blank, masked address kept as a hint.
    assert po.recipient_name == ""
    assert po.recipient_phone == ""
    assert "南京市" in po.recipient_address and "****" in po.recipient_address


def test_original_amount_is_list_total_plus_postage():
    # 单期零售: goods list ¥5, postage ¥5, paid (incl postage) ¥9.25.
    [po] = parse_taobao_orders(_wb_bytes([_row(
        goods="4.25", postage="5.00", list_total="5.00", paid="9.25",
        title="单期零售《中国经营报》刊社直发", sku="",
    )]))
    assert po.paid_amount == Decimal("9.25")
    assert po.original_amount == Decimal("10.00")  # 5 list + 5 postage → discount = 0.75


def test_sku_folded_into_product_name():
    [po] = parse_taobao_orders(_wb_bytes([_row(sku="分册名:全年-邮局-周投[（投信报箱）]")]))
    assert len(po.product_lines) == 1
    line = po.product_lines[0]
    assert "全年-邮局-周投" in line.name  # 分册名 folded in so delivery/期次 are matchable
    assert line.mentions_zto is False
    assert line.is_shipping is False


def test_single_line_quantity_from_total_qty():
    [po] = parse_taobao_orders(_wb_bytes([_row(total_qty="11", title="单期零售《中国经营报》", sku="")]))
    assert len(po.product_lines) == 1
    assert po.product_lines[0].quantity == 11


def test_multi_product_even_splits_paid():
    title = (
        "【2026单期】《商学院》杂志订阅商业财经经济时政新闻热点资讯,"
        "【2026单期】《商学院》杂志订阅商业财经经济时政新闻热点资讯"
    )
    [po] = parse_taobao_orders(_wb_bytes([_row(
        title=title, kinds="2", total_qty="2", paid="80.00", sku="",
    )]))
    assert len(po.product_lines) == 2
    for line in po.product_lines:
        assert line.quantity == 1
        assert line.unit_price == Decimal("40")  # 80 / 2 even split


def test_notes_preserve_merchant_note_and_tracking():
    [po] = parse_taobao_orders(_wb_bytes([_row(note="6月开始到年底", tracking="73600316247086")]))
    assert "6月开始到年底" in po.notes
    assert "73600316247086" in po.notes  # tracking folded into notes (no model field)


def test_blank_rows_skipped():
    rows = [_row(order_no="A1"), _row(order_no="")]
    orders = parse_taobao_orders(_wb_bytes(rows))
    assert [o.external_order_no for o in orders] == ["A1"]
