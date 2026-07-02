"""邮局投诉导入 · 单元测试（P2.2）。"""

import io
from datetime import date

import openpyxl
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    Order,
    OrderEntryMethod,
    OrderStatus,
    Partner,
    PartnerType,
    PostalComplaint,
)
from app.services.postal_complaint_import_service import (
    build_complaint_preview,
    commit_import,
    preview_import,
)
from app.services.postal_complaint_parser import parse_postal_complaints

_CH = ["接诉日期", "姓名", "联系电话", "省", "市", "区", "详细地址", "邮编", "年度",
       "投诉情况", "处理情况", "回访", "处理次数", "编号", "第一接诉人", "投递渠道单位", "备注"]

_ROWS = [
    {"接诉日期": "2024-01-03", "姓名": "马宁", "联系电话": "18051929810", "省": "江苏省",
     "市": "徐州市", "区": "泉山区", "详细地址": "二环西路西湖美景2-3-102", "邮编": "221006",
     "年度": "2024年", "投诉情况": "2024年1月1日第一期没有收到", "处理情况": "转徐州11185",
     "回访": "已收到2024.1.1", "处理次数": "1", "编号": "000680", "投递渠道单位": "北京集订分送"},
    {"接诉日期": "2024-01-05", "姓名": "李四", "联系电话": "13900000000", "省": "北京市",
     "市": "北京市", "区": "朝阳区", "详细地址": "xx路1号", "年度": "2024年",
     "投诉情况": "1月没收到", "处理情况": "北京局", "处理次数": "", "编号": "999999"},
]


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(bind=engine)()
    try:
        yield s
    finally:
        s.close()


def _wb(rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "邮局年投诉"
    ws.append(_CH)
    for r in rows:
        ws.append([r.get(h, "") for h in _CH])
    b = io.BytesIO()
    wb.save(b)
    return b.getvalue()


def _seed(db):
    o = Order(order_date=date(2024, 1, 1), entry_method=OrderEntryMethod.excel_import,
              external_order_no="2024-680", payer_name="马宁", status=OrderStatus.active)
    db.add(o)
    db.add(Partner(name="北京集订分送", partner_type=PartnerType.distribution))
    db.commit()
    return o


def test_parse_link_route_status(db):
    o = _seed(db)
    parsed = parse_postal_complaints(_wb(_ROWS))
    assert len(parsed) == 2

    pv = build_complaint_preview(db, parsed)
    assert pv.counts["import"] == 2
    assert pv.counts["linked"] == 1  # 只有 000680 命中订单

    r0 = pv.rows[0]
    assert r0.data["order_id"] == o.id           # 000680 去零 → 2024-680 挂订单
    assert r0.data["routed_label"] == "徐州11185"  # 处理情况归一
    assert r0.data["routed_unit_id"] is not None  # 投递渠道单位挂 Partner
    assert r0.status == "resolved"                # 有回访

    r1 = pv.rows[1]
    assert r1.data["order_id"] is None            # 999999 无订单
    assert r1.data["routed_label"] == "北京局"
    assert r1.status == "open"                    # 无回访


def test_commit_and_reimport_idempotent(db):
    _seed(db)
    out, sid = preview_import(db, _wb(_ROWS))
    assert out["counts"]["import"] == 2
    assert commit_import(db, sid)["created"] == 2

    c = db.query(PostalComplaint).filter(PostalComplaint.external_order_no == "2024-680").one()
    assert c.order_id is not None
    assert c.status.value == "resolved"
    assert c.handling_count == 1

    out2, _ = preview_import(db, _wb(_ROWS))
    assert out2["counts"]["duplicate"] == 2
    assert out2["counts"]["import"] == 0
