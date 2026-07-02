"""邮局改地址 + 回访导入 · 单元测试（P3）。"""

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
    DeliveryMethod,
    FulfillmentTarget,
    FulfillmentType,
    Order,
    OrderEntryMethod,
    OrderStatus,
    PostalAddressChange,
    PostalFollowUp,
    Publication,
    PublicationFormat,
    ShippingChannel,
)
from app.schemas.order import FulfillmentTargetIn, OrderCreate, OrderItemIn
from app.services import postal_change_service as change_svc
from app.services.order_service import create_imported_order
from app.services.postal_address_change_import_service import (
    build_address_change_preview,
    commit_import as addr_commit,
    preview_import as addr_preview,
)
from app.services.postal_address_change_parser import parse_postal_address_changes
from app.services.postal_follow_up_import_service import (
    commit_import as follow_commit,
    preview_import as follow_preview,
)
from app.services.postal_follow_up_parser import parse_postal_follow_ups


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(bind=engine)()
    try:
        yield s
    finally:
        s.close()


def _post_office_order(db, ext, name, addr="旧地址1号"):
    oc = OrderCreate(
        external_order_no=ext, order_date=date(2024, 1, 1), payer_name=name,
        total_amount=Decimal("240"), paid_amount=Decimal("240"),
        items=[OrderItemIn(
            publication=Publication.cbj, publication_format=PublicationFormat.paper,
            fulfillment_type=FulfillmentType.subscription, billing_type=BillingType.paid,
            delivery_method=DeliveryMethod.post_office,
            coverage_start_date=date(2024, 1, 1), coverage_end_date=date(2024, 12, 31),
            total_quantity=1, unit_price=Decimal("240"), subtotal=Decimal("240"),
            targets=[FulfillmentTargetIn(recipient_name=name, recipient_address=addr, quantity=1,
                                         shipping_channel=ShippingChannel.post_office)],
        )],
    )
    return create_imported_order(db, oc, order_code=f"C-{ext}")


# ---- 改地址 ----------------------------------------------------------------

_ADDR_HEADERS = ["修改日期", "姓名", "联系电话", "省", "市", "区", "详细地址", "份数",
                 "新姓名", "新电话", "新地址", "处理情况",
                 "原读者起月日 (邮局2024读者明细)", "实际起月日", "份数2", "编号", "备注"]
_ADDR_ROWS = [
    {"修改日期": "2024-01-03", "姓名": "韩博武", "编号": "000402",
     "新地址": "陕西省西安市碑林区西木头市真爱粉巷里5层519室", "处理情况": "转北京局微信"},
    {"修改日期": "2024-01-05", "姓名": "赵旭", "编号": "000637", "新姓名": "肖老师",
     "新电话": "18616817895", "新地址": "上海市浦东新区沪南路2199弄4号楼604", "处理情况": "转北京局微信"},
]


def _addr_wb(rows):
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "邮局年改地址"; ws.append(_ADDR_HEADERS)
    for r in rows:
        ws.append([r.get(h, "") for h in _ADDR_HEADERS])
    b = io.BytesIO(); wb.save(b); return b.getvalue()


def test_address_change_parse_link_commit(db):
    _post_office_order(db, "2024-402", "韩博武")  # 让 402 挂上订单
    db.commit()
    parsed = parse_postal_address_changes(_addr_wb(_ADDR_ROWS))
    assert len(parsed) == 2
    # 括注表头「原读者起月日 (…)」被正确识别
    assert parsed[0].external_no_raw == "000402"

    pv = build_address_change_preview(db, parsed)
    assert pv.counts["import"] == 2
    assert pv.counts["linked"] == 1  # 只有 402 有订单
    r0 = pv.rows[0]
    assert r0.data["order_id"] is not None
    assert r0.data["routed_label"] == "北京局"

    out, sid = addr_preview(db, _addr_wb(_ADDR_ROWS))
    assert addr_commit(db, sid)["created"] == 2
    # 幂等
    out2, _ = addr_preview(db, _addr_wb(_ADDR_ROWS))
    assert out2["counts"]["duplicate"] == 2


def test_address_change_apply_reflow(db):
    _post_office_order(db, "2024-637", "赵旭", addr="上海市旧地址")
    db.commit()
    _, sid = addr_preview(db, _addr_wb(_ADDR_ROWS))
    addr_commit(db, sid)

    ac = db.query(PostalAddressChange).filter(PostalAddressChange.external_order_no == "2024-637").one()
    assert ac.order_id is not None
    change_svc.apply_address_change(db, ac.id, operator_id=1)

    # 回流后：订单收报人姓名/电话/地址被新值覆盖
    tgt = db.query(FulfillmentTarget).one()
    assert tgt.recipient_name == "肖老师"
    assert tgt.recipient_phone == "18616817895"
    assert tgt.recipient_address == "上海市浦东新区沪南路2199弄4号楼604"
    db.refresh(ac)
    assert ac.applied_to_order is True and ac.applied_by == 1
    # 重复回流被拒
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as ei:
        change_svc.apply_address_change(db, ac.id)
    assert ei.value.status_code == 409


# ---- 回访（拍平按天列）-----------------------------------------------------

_R_HEADERS = ["编号", "姓名", "省", "市", "区", "详细地址", "年度", "产品名称", "起月日", "止月日",
              "份数", "金额", "渠道", "投递单位", "20240227回访", "2025回访"]
_R_ROWS = [
    {"编号": "719", "姓名": "张三", "年度": "2024年", "产品名称": "中国经营报", "起月日": "0101",
     "止月日": "1231", "份数": "1", "金额": "240", "投递单位": "北京集订分送",
     "20240227回访": "——", "2025回访": "拒接"},
    {"编号": "720", "姓名": "李四", "年度": "2024年", "产品名称": "中国经营报", "起月日": "0101",
     "止月日": "1231", "份数": "1", "金额": "240", "投递单位": "北京集订分送"},  # 无回访
]


def _reader_wb(rows):
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "邮局读者明细"; ws.append(_R_HEADERS)
    for r in rows:
        ws.append([r.get(h, "") for h in _R_HEADERS])
    b = io.BytesIO(); wb.save(b); return b.getvalue()


def test_follow_up_flatten_and_link(db):
    _post_office_order(db, "2024-719", "张三")
    db.commit()
    parsed = parse_postal_follow_ups(_reader_wb(_R_ROWS))
    # 张三 2 条(20240227回访/2025回访)，李四 0 条
    assert len(parsed) == 2

    out, sid = follow_preview(db, _reader_wb(_R_ROWS))
    assert out["counts"]["import"] == 2
    assert out["counts"]["linked"] == 2  # 都挂到 2024-719
    assert follow_commit(db, sid)["created"] == 2

    fus = db.query(PostalFollowUp).order_by(PostalFollowUp.batch_label).all()
    by_label = {f.batch_label: f for f in fus}
    assert by_label["20240227回访"].follow_up_date == date(2024, 2, 27)
    assert by_label["2025回访"].follow_up_date is None
    assert by_label["2025回访"].result == "拒接"

    out2, _ = follow_preview(db, _reader_wb(_R_ROWS))
    assert out2["counts"]["duplicate"] == 2
