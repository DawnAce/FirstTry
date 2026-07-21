"""订报生成 → 投递名册 汇入 + 历史导入「新值优先」单元测试。"""

import io

import pytest
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    Partner,
    PartnerType,
    PostalDelivery,
    PostalDeliverySourceType,
)
from app.services import attachment_service as att
from app.services import subscription_import_service as imp
from app.services import subscription_postal_sync_service as sync_svc
from app.services import subscription_service as bs

A_HEADERS = ["地区", "姓名", "联系电话", "省", "市", "区", "详细地址", "邮编", "年度",
             "产品名称", "起月日", "止月日", "份数", "金额", "渠道", "汇款名称", "汇款日期"]


@pytest.fixture(autouse=True)
def _isolate_uploads(tmp_path, monkeypatch):
    monkeypatch.setattr(att, "UPLOAD_ROOT", tmp_path / "uploads")


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    for n in ["北京集订分送", "安徽集订分送", "广东集订分送"]:
        s.add(Partner(name=n, partner_type=PartnerType.distribution))
    s.commit()
    try:
        yield s
    finally:
        s.close()


def _unit_id(db, name):
    return db.query(Partner.id).filter(Partner.name == name).scalar()


def _source_a(records):
    wb = Workbook(); ws = wb.active
    ws.append(A_HEADERS)
    for name, phone, addr in records:
        ws.append(["", name, phone, addr, "", "", "", "", "2026年", "中国经营报",
                   "0801", "1231", 1, 100, "中经报有赞", "高汇通", "20260316到账100"])
    bio = io.BytesIO(); wb.save(bio); return bio.getvalue()


def _activate_batch(db, records, year=2026, month=8):
    batch = bs.create_batch(db, {"year": year, "start_month": month, "make_date": None,
                                 "unit_price": None, "notes": None}, operator_id=None)
    v = imp.create_version(db, batch, [("A", "a.xlsx", _source_a(records))], operator_id=None)
    bs.activate_version(db, v.id, operator_id=1)
    return batch, v


# --- 投递单位映射 -----------------------------------------------------------

def test_resolve_distribution_unit_beijing_fallback(db):
    assert sync_svc.resolve_distribution_unit(db, "安徽省") == _unit_id(db, "安徽集订分送")
    assert sync_svc.resolve_distribution_unit(db, "广东省") == _unit_id(db, "广东集订分送")
    # 无专属单位的省 → 北京兜底
    for prov in ("上海市", "北京市", "四川省", "福建省"):
        assert sync_svc.resolve_distribution_unit(db, prov) == _unit_id(db, "北京集订分送")


# --- 汇入 -------------------------------------------------------------------

def test_activate_syncs_into_postal_delivery(db):
    batch, v = _activate_batch(db, [
        ("张三", "13800138000", "北京市朝阳区建国路1号"),
        ("李四", "13911112222", "广东省广州市天河区体育西路100号"),
    ])
    pds = db.query(PostalDelivery).filter(PostalDelivery.subscription_batch_id == batch.id).all()
    assert len(pds) == 2
    for p in pds:
        assert p.source_type == PostalDeliverySourceType.subscription_generated
        assert p.coverage_start_date.isoformat() == "2026-08-01"
        assert p.coverage_end_date.isoformat() == "2026-12-31"
        assert p.delivery_no.isdigit()
    # 北京兜底 vs 广东专属
    by_name = {p.recipient_name: p for p in pds}
    assert by_name["李四"].distribution_unit_id == _unit_id(db, "广东集订分送")
    assert by_name["张三"].distribution_unit_id == _unit_id(db, "北京集订分送")


def test_reactivate_replaces_no_duplicates(db):
    batch, _ = _activate_batch(db, [("张三", "13800138000", "北京市朝阳区建国路1号")])
    # 重导新版并再激活
    v2 = imp.create_version(db, batch, [("A", "a2.xlsx", _source_a([
        ("张三", "13800138000", "北京市朝阳区建国路1号"),
        ("王五", "13712345678", "广东省深圳市南山区科技路5号"),
    ]))], operator_id=None)
    ver2 = bs.activate_version(db, v2.id, operator_id=1)
    assert ver2.postal_sync["replaced"] == 1 and ver2.postal_sync["created"] == 2
    assert db.query(PostalDelivery).filter(PostalDelivery.subscription_batch_id == batch.id).count() == 2


def test_delivery_no_sequences_after_existing(db):
    # 预置一条 2026 年编号 700 的历史记录
    db.add(PostalDelivery(year=2026, delivery_no="700", source_type=PostalDeliverySourceType.historical_import,
                          recipient_name="老王", recipient_address="北京市西城区", copies=1))
    db.commit()
    batch, _ = _activate_batch(db, [("张三", "13800138000", "北京市朝阳区建国路1号")])
    p = db.query(PostalDelivery).filter(PostalDelivery.subscription_batch_id == batch.id).first()
    assert int(p.delivery_no) == 701  # max(700)+1


def test_reactivate_fully_replaces_no_freeze(db):
    """月度批次冻结层已移除：再激活整批替换，不再保留任何旧记录。"""
    batch, _ = _activate_batch(db, [("张三", "13800138000", "北京市朝阳区建国路1号")])
    v2 = imp.create_version(db, batch, [("A", "a2.xlsx", _source_a([("赵六", "13500000000", "北京市海淀区中关村1号")]))], operator_id=None)
    ver2 = bs.activate_version(db, v2.id, operator_id=1)
    assert ver2.postal_sync["skipped_sent"] == 0
    names = {p.recipient_name for p in db.query(PostalDelivery).filter(PostalDelivery.subscription_batch_id == batch.id)}
    assert names == {"赵六"}  # 张三 被整批替换掉


# --- 历史导入「新值优先」 ---------------------------------------------------

def test_historical_import_applies_new_contact(db):
    from app.services import postal_delivery_import_service as him
    hdr = ["编号", "地区", "新姓名", "新电话", "新地址", "姓名", "联系电话", "省", "市", "区",
           "详细地址", "邮编", "年度", "产品名称", "起月日", "止月日", "份数", "金额", "渠道",
           "汇款名称", "汇款日期", "投递单位", "赠阅/关联", "备注"]
    wb = Workbook(); ws = wb.active
    ws.append(hdr)
    ws.append([680, "北京", "", "", "北京市海淀区中关村大街5号新址", "张三", "13800138000",
               "北京市", "北京市", "朝阳区", "朝阳区建国路1号", "100000", "2024年", "中国经营报",
               "0101", "1231", 1, 240, "CBJ+小程序", "发行部", "20231201到账238", "北京集订分送", "", ""])
    bio = io.BytesIO(); wb.save(bio)
    out, sid = him.preview_import(db, bio.getvalue())
    assert out["counts"]["import"] == 1
    him.commit_import(db, sid, operator_id=1)
    rec = db.query(PostalDelivery).filter(PostalDelivery.year == 2024, PostalDelivery.delivery_no == "680").one()
    # 新地址生效、原详址留痕
    assert "中关村大街5号新址" in rec.recipient_address
    assert rec.notes and "原址" in rec.notes
    assert rec.recipient_province == "北京市"
