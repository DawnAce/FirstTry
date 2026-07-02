"""提现发票导入 · 单元测试（P4.2）。"""

import io
from datetime import date
from decimal import Decimal

import openpyxl
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Order, OrderEntryMethod, OrderStatus, PostalFinance
from app.services.postal_finance_import_service import (
    build_finance_preview,
    commit_import,
    preview_import,
)
from app.services.postal_finance_parser import parse_postal_finance

_H = ["姓名", "商品名称", "份数", "金额", "手续费", "到款金额", "到款日期", "开票金额",
      "发票信息", "发票接收手机/邮箱", "发票类型", "订单平台", "订单号"]
_ROWS = [
    {"姓名": "张翠", "商品名称": "《中国经营报》", "份数": "1", "金额": "240", "手续费": "1.3",
     "到款金额": "238.7", "到款日期": "2024-01-30", "开票金额": "240",
     "发票信息": "发票抬头：武汉景雅居房地产经纪有限公司 \n购方税号：91420106555042474C",
     "发票类型": "普票", "订单平台": "CBJ+小程序"},
    {"姓名": "吴婷", "商品名称": "《中国经营报》", "份数": "1", "金额": "20", "手续费": "0.11",
     "到款金额": "", "到款日期": "2024-01-16", "开票金额": "20",
     "发票信息": "不开票", "发票类型": "普票", "订单平台": "CBJ+小程序", "订单号": "TB-2026-XYZ"},
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
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "提现发票合集"; ws.append(_H)
    for r in rows:
        ws.append([r.get(h, "") for h in _H])
    b = io.BytesIO(); wb.save(b); return b.getvalue()


def _order(db, *, payer, ext=None):
    o = Order(order_date=date(2024, 1, 1), entry_method=OrderEntryMethod.excel_import,
              external_order_no=ext, payer_name=payer, status=OrderStatus.active)
    db.add(o); db.flush()
    return o


def test_parse_link_and_amounts(db):
    o1 = _order(db, payer="张翠")           # 姓名唯一 → name 链接
    o2 = _order(db, payer="吴婷", ext="TB-2026-XYZ")  # 订单号链接
    db.commit()

    parsed = parse_postal_finance(_wb(_ROWS))
    assert len(parsed) == 2
    pv = build_finance_preview(db, parsed)
    assert pv.counts["import"] == 2 and pv.counts["linked"] == 2

    r0 = pv.rows[0].data
    assert r0["order_id"] == o1.id and pv.rows[0].link_by == "name"
    assert r0["buyer_title"] == "武汉景雅居房地产经纪有限公司"
    assert r0["tax_no"] == "91420106555042474C"
    assert r0["net_amount"] == "238.7"       # 原样
    assert r0["tax_category"] == "普票"

    r1 = pv.rows[1].data
    assert r1["order_id"] == o2.id and pv.rows[1].link_by == "order_no"  # 订单号优先
    assert r1["net_amount"] == "19.89"       # 到款金额空 → 金额20 − 手续费0.11
    assert r1["buyer_title"] is None         # "不开票"


def test_name_ambiguous_not_linked(db):
    _order(db, payer="张翠"); _order(db, payer="张翠")  # 重名两单 → 不挂
    db.commit()
    pv = build_finance_preview(db, parse_postal_finance(_wb([_ROWS[0]])))
    assert pv.rows[0].data["order_id"] is None and pv.rows[0].link_by == "none"


def test_commit_and_idempotent(db):
    _order(db, payer="张翠"); _order(db, payer="吴婷", ext="TB-2026-XYZ")
    db.commit()
    out, sid = preview_import(db, _wb(_ROWS))
    assert commit_import(db, sid)["created"] == 2
    assert db.query(PostalFinance).count() == 2
    assert db.query(PostalFinance).filter(PostalFinance.payer_name == "张翠").one().net_amount == Decimal("238.70")

    out2, _ = preview_import(db, _wb(_ROWS))
    assert out2["counts"]["duplicate"] == 2


def test_no_identifier_row_dedups(db):
    """无订单号且无姓名的行也参与去重（重导不重复）。"""
    nameless = [{"商品名称": "《中国经营报》", "金额": "100", "到款金额": "100",
                 "到款日期": "2024-01-01", "发票信息": "不开票", "发票类型": "普票", "订单平台": "CBJ+小程序"}]
    out, sid = preview_import(db, _wb(nameless))
    assert out["counts"]["import"] == 1
    commit_import(db, sid)
    out2, _ = preview_import(db, _wb(nameless))
    assert out2["counts"]["duplicate"] == 1 and out2["counts"]["import"] == 0
