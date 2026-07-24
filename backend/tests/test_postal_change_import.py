"""邮局改地址 + 回访导入 · 单元测试（重构后：关联投递记录；应用新地址写回记录）。"""

import io
from datetime import date, datetime
from decimal import Decimal

import openpyxl
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    BillingType,
    DeliveryMethod,
    FulfillmentTarget,
    FulfillmentType,
    PostalAddressChange,
    PostalDelivery,
    PostalFollowUp,
    Publication,
    PublicationFormat,
    ShippingChannel,
    TargetStatus,
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


def _delivery(
    db,
    no,
    name,
    *,
    addr="旧地址1号",
    year=2024,
    order_id=None,
    order_item_id=None,
    fulfillment_target_id=None,
):
    d = PostalDelivery(year=year, delivery_no=no, recipient_name=name,
                       recipient_address=addr, copies=1,
                       coverage_start_date=date(year, 1, 1), order_id=order_id,
                       order_item_id=order_item_id,
                       fulfillment_target_id=fulfillment_target_id)
    db.add(d)
    db.flush()
    return d


def _real_order(db, ext, name, addr="旧地址1号"):
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


def _second_target(db, first, *, name="另一位收报人", addr="另一地址2号"):
    target = FulfillmentTarget(
        order_item_id=first.order_item_id,
        allocation_id=first.allocation_id,
        recipient_name=name,
        recipient_address=addr,
        quantity=1,
        shipping_channel=ShippingChannel.post_office,
    )
    db.add(target)
    db.flush()
    return target


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
    d = _delivery(db, "402", "韩博武")  # 让 402 关联到投递记录
    db.commit()
    parsed = parse_postal_address_changes(_addr_wb(_ADDR_ROWS))
    assert len(parsed) == 2
    # 括注表头「原读者起月日 (…)」被正确识别
    assert parsed[0].external_no_raw == "000402"

    pv = build_address_change_preview(db, parsed)
    assert pv.counts["import"] == 2
    assert pv.counts["linked"] == 1  # 只有 402 关联到投递记录
    r0 = pv.rows[0]
    assert r0.data["postal_delivery_id"] == d.id
    assert r0.data["order_id"] is None
    assert r0.data["routed_label"] == "北京局"

    out, sid = addr_preview(db, _addr_wb(_ADDR_ROWS))
    assert addr_commit(db, sid)["created"] == 2
    imported = db.query(PostalAddressChange).filter_by(external_order_no="2024-402").one()
    assert imported.change_date == datetime(2024, 1, 3, 0, 0)
    # 幂等
    out2, _ = addr_preview(db, _addr_wb(_ADDR_ROWS))
    assert out2["counts"]["duplicate"] == 2


def test_apply_writes_back_to_delivery_record(db):
    """应用新地址：写回投递记录（无订单也能应用）；重复应用被拒。"""
    _delivery(db, "637", "赵旭", addr="上海市旧地址")
    db.commit()
    _, sid = addr_preview(db, _addr_wb([_ADDR_ROWS[1]]))
    addr_commit(db, sid)

    ac = db.query(PostalAddressChange).filter(PostalAddressChange.external_order_no == "2024-637").one()
    assert ac.postal_delivery_id is not None
    change_svc.apply_address_change(db, ac.id, operator_id=1)

    rec = db.query(PostalDelivery).filter_by(delivery_no="637").one()
    assert rec.recipient_name == "肖老师"
    assert rec.recipient_phone == "18616817895"
    assert rec.recipient_address == "上海市浦东新区沪南路2199弄4号楼604"
    db.refresh(ac)
    assert ac.applied_to_order is True and ac.applied_by == 1

    # 重复应用被拒
    with pytest.raises(HTTPException) as ei:
        change_svc.apply_address_change(db, ac.id)
    assert ei.value.status_code == 409


def test_apply_also_updates_linked_real_order(db):
    """投递记录挂了真实订单 → 应用新地址一并更新订单收报人。"""
    order = _real_order(db, "PLAT-637", "赵旭", addr="上海市旧地址")
    _delivery(db, "637", "赵旭", addr="上海市旧地址", order_id=order.id)
    db.commit()
    _, sid = addr_preview(db, _addr_wb([_ADDR_ROWS[1]]))
    addr_commit(db, sid)
    ac = db.query(PostalAddressChange).one()
    change_svc.apply_address_change(db, ac.id, operator_id=1)

    tgt = db.query(FulfillmentTarget).one()
    assert tgt.recipient_name == "肖老师"
    assert tgt.recipient_phone == "18616817895"
    assert tgt.recipient_address == "上海市浦东新区沪南路2199弄4号楼604"
    delivery = db.query(PostalDelivery).one()
    assert delivery.order_item_id == tgt.order_item_id
    assert delivery.fulfillment_target_id == tgt.id


def test_apply_updates_explicit_target_only_when_order_has_multiple_targets(db):
    """显式绑定 fulfillment_target_id 时，只修改该目标，不碰同订单其他收报人。"""
    order = _real_order(db, "PLAT-638", "赵旭", addr="上海市旧地址")
    first = db.query(FulfillmentTarget).one()
    second = _second_target(db, first)
    delivery = _delivery(
        db,
        "638",
        "赵旭",
        addr="上海市旧地址",
        order_id=order.id,
        order_item_id=first.order_item_id,
        fulfillment_target_id=first.id,
    )
    ac = PostalAddressChange(
        year=2024,
        external_order_no="2024-638",
        postal_delivery_id=delivery.id,
        order_id=order.id,
        new_name="赵旭新",
        new_address="上海市浦东新区新地址8号",
    )
    db.add(ac)
    db.commit()

    change_svc.apply_address_change(db, ac.id, operator_id=1)

    db.refresh(first)
    db.refresh(second)
    assert first.recipient_name == "赵旭新"
    assert first.recipient_address == "上海市浦东新区新地址8号"
    assert second.recipient_name == "另一位收报人"
    assert second.recipient_address == "另一地址2号"


def test_apply_rejects_ambiguous_order_targets_without_writing(db):
    """没有绑定目标且订单存在多个当前邮局目标时返回 409，名册和订单都不改。"""
    order = _real_order(db, "PLAT-639", "赵旭", addr="上海市旧地址")
    first = db.query(FulfillmentTarget).one()
    second = _second_target(db, first)
    delivery = _delivery(db, "639", "赵旭", addr="上海市旧地址", order_id=order.id)
    ac = PostalAddressChange(
        year=2024,
        external_order_no="2024-639",
        postal_delivery_id=delivery.id,
        order_id=order.id,
        new_name="不应写入",
        new_address="不应写入的新地址",
    )
    db.add(ac)
    db.commit()

    with pytest.raises(HTTPException) as ei:
        change_svc.apply_address_change(db, ac.id, operator_id=1)
    assert ei.value.status_code == 409
    assert "多个当前邮局履约目标" in ei.value.detail

    db.refresh(delivery)
    db.refresh(first)
    db.refresh(second)
    db.refresh(ac)
    assert delivery.recipient_name == "赵旭"
    assert delivery.recipient_address == "上海市旧地址"
    assert first.recipient_name == "赵旭"
    assert second.recipient_name == "另一位收报人"
    assert ac.applied_to_order is False


def test_apply_rejects_stale_explicit_target(db):
    """显式绑定的目标已失效时不自动改到别的目标。"""
    order = _real_order(db, "PLAT-640", "赵旭", addr="上海市旧地址")
    target = db.query(FulfillmentTarget).one()
    target.status = TargetStatus.suspended
    delivery = _delivery(
        db,
        "640",
        "赵旭",
        addr="上海市旧地址",
        order_id=order.id,
        fulfillment_target_id=target.id,
    )
    ac = PostalAddressChange(
        year=2024,
        external_order_no="2024-640",
        postal_delivery_id=delivery.id,
        order_id=order.id,
        new_address="不应写入的新地址",
    )
    db.add(ac)
    db.commit()

    with pytest.raises(HTTPException) as ei:
        change_svc.apply_address_change(db, ac.id, operator_id=1)
    assert ei.value.status_code == 409
    assert "已失效或不属于该订单" in ei.value.detail
    db.refresh(delivery)
    assert delivery.recipient_address == "上海市旧地址"


def test_apply_unmatched_is_rejected(db):
    """未关联到投递记录（未匹配）→ 应用被拦（先导入读者名册）。"""
    ac = PostalAddressChange(change_date=date(2026, 4, 20), external_order_no=None,
                             new_name="赵伟", new_address="成都新地址", postal_delivery_id=None)
    db.add(ac); db.commit()
    with pytest.raises(HTTPException) as ei:
        change_svc.apply_address_change(db, ac.id)
    assert ei.value.status_code == 400


def test_cross_year_uses_header_declared_year(db):
    """跨年改地址：修改日期在次年(2025)，靠表头括注声明的读者年度(2024)挂对投递记录。"""
    d = _delivery(db, "402", "韩博武")  # 2024 投递记录
    db.commit()
    # 修改日期 2025-01-10（次年提交），表头「原读者起月日 (邮局2024读者明细)」声明读者=2024
    rows = [{"修改日期": "2025-01-10", "姓名": "韩博武", "编号": "000402",
             "新地址": "陕西省西安市新地址", "处理情况": "转北京局微信"}]
    pv = build_address_change_preview(db, parse_postal_address_changes(_addr_wb(rows)))
    assert pv.counts["linked"] == 1
    assert pv.rows[0].data["postal_delivery_id"] == d.id
    assert pv.rows[0].data["external_order_no"] == "2024-402"  # 用括注年度而非修改日期年份


def test_apply_new_copies_zero(db):
    """份数改 0 也能应用（不被真值判断静默跳过）。"""
    _delivery(db, "800", "某人")
    db.commit()
    rows = [{"修改日期": "2024-02-01", "姓名": "某人", "编号": "800", "份数2": "0",
             "新地址": "新址", "处理情况": "转北京局微信"}]
    _, sid = addr_preview(db, _addr_wb(rows))
    addr_commit(db, sid)
    ac = db.query(PostalAddressChange).filter_by(external_order_no="2024-800").one()
    change_svc.apply_address_change(db, ac.id)
    rec = db.query(PostalDelivery).filter_by(delivery_no="800").one()
    assert rec.copies == 0


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
    _delivery(db, "719", "张三")  # 关联投递记录
    db.commit()
    parsed = parse_postal_follow_ups(_reader_wb(_R_ROWS))
    # 张三 2 条(20240227回访/2025回访)，李四 0 条
    assert len(parsed) == 2

    out, sid = follow_preview(db, _reader_wb(_R_ROWS))
    assert out["counts"]["import"] == 2
    assert out["counts"]["linked"] == 2  # 都关联到 2024-719 投递记录
    assert follow_commit(db, sid)["created"] == 2

    fus = db.query(PostalFollowUp).order_by(PostalFollowUp.batch_label).all()
    by_label = {f.batch_label: f for f in fus}
    assert by_label["20240227回访"].follow_up_date == date(2024, 2, 27)
    assert by_label["20240227回访"].postal_delivery_id is not None
    assert by_label["2025回访"].follow_up_date is None
    assert by_label["2025回访"].result == "拒接"

    out2, _ = follow_preview(db, _reader_wb(_R_ROWS))
    assert out2["counts"]["duplicate"] == 2
