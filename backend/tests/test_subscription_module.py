"""邮局订报数据生成模块 · 流水线单元测试（解析 → 校验 → 计算 → 版本流水 → 生成）。

黄金样本（8月）逐项比对与 7月回归待业务方样本到位后补入（见实施说明 §13）。
"""

import io
from datetime import date

import pytest
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    Partner,
    PartnerType,
    SubscriptionBatchStatus,
    SubscriptionImportStatus,
    SubscriptionRunStatus,
)
from app.services import subscription_generation_service as gen_svc
from app.services import subscription_import_service as import_svc
from app.services import subscription_service as batch_svc


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


def _source_a(rows):
    """rows: list of [姓名,电话,地址,份数,月数,投递单位] → xlsx bytes。"""
    wb = Workbook()
    ws = wb.active
    ws.append(["姓名", "电话", "地址", "份数", "月数", "投递单位"])
    for r in rows:
        ws.append(r)
    bio = io.BytesIO()
    wb.save(bio)
    return bio.getvalue()


def _unit(db, name="北京集订分送"):
    p = Partner(name=name, partner_type=PartnerType.distribution)
    db.add(p)
    db.commit()
    return p.id


def _batch(db, unit_price=None):
    return batch_svc.create_batch(
        db, {"year": 2026, "start_month": 8, "make_date": None,
             "unit_price": unit_price, "notes": None}, operator_id=None
    )


def test_import_computes_amount_and_regions(db):
    _unit(db)
    a = _source_a([
        ["张三", "13800138000", "北京市朝阳区建国路1号", 1, 12, "北京集订分送"],
        ["李四", "13911112222", "北京市海淀区中关村大街5号", 2, 6, "北京集订分送"],
        ["王五", "13712345678", "广东省广州市天河区体育西路100号", 1, 12, ""],
    ])
    batch = _batch(db)
    v = import_svc.create_version(db, batch, [("A", "订阅明细.xlsx", a)], operator_id=None)

    assert v.status == SubscriptionImportStatus.validation_passed
    assert v.summary_json["total_count"] == 3
    assert v.summary_json["total_copies"] == 4
    # 1×12×20 + 2×6×20 + 1×12×20 = 240+240+240 = 720
    assert v.summary_json["total_amount"] == "720.00"
    assert v.summary_json["region_count"] == 2
    amounts = sorted(str(r.amount) for r in v.records)
    assert amounts == ["240.00", "240.00", "240.00"]


def test_duplicate_subscriber_blocks(db):
    a = _source_a([
        ["张三", "13800138000", "北京市朝阳区建国路1号", 1, 12, ""],
        ["张三", "13800138000", "北京市朝阳区建国路2号", 1, 12, ""],
    ])
    batch = _batch(db)
    v = import_svc.create_version(db, batch, [("A", "a.xlsx", a)], operator_id=None)
    assert v.status == SubscriptionImportStatus.validation_failed
    assert any(i.code == "duplicate_subscriber" and i.level.value == "block" for i in v.issues)


def test_invalid_copies_or_months_block(db):
    a = _source_a([
        ["张三", "13800138000", "北京市朝阳区建国路1号", 0, 12, ""],   # 份数 0
        ["李四", "13911112222", "北京市海淀区中关村大街5号", 1, 0, ""],  # 月数 0
    ])
    batch = _batch(db)
    v = import_svc.create_version(db, batch, [("A", "a.xlsx", a)], operator_id=None)
    assert v.status == SubscriptionImportStatus.validation_failed
    codes = {i.code for i in v.issues}
    assert "copies_non_positive" in codes
    assert "months_invalid" in codes


def test_version_flow_supersedes_old_active(db):
    a1 = _source_a([["张三", "13800138000", "北京市朝阳区建国路1号", 1, 12, ""]])
    a2 = _source_a([["李四", "13911112222", "北京市海淀区中关村大街5号", 1, 12, ""]])
    batch = _batch(db)
    v1 = import_svc.create_version(db, batch, [("A", "v1.xlsx", a1)], operator_id=None)
    batch_svc.activate_version(db, v1.id)
    assert batch.active_version_id == v1.id
    assert batch.status == SubscriptionBatchStatus.ready

    v2 = import_svc.create_version(db, batch, [("A", "v2.xlsx", a2)], operator_id=None)
    assert v2.version_no == 2
    batch_svc.activate_version(db, v2.id)
    db.refresh(v1)
    assert v1.status == SubscriptionImportStatus.superseded
    assert batch.active_version_id == v2.id


def test_generate_produces_all_artifacts(db):
    _unit(db)
    a = _source_a([
        ["张三", "13800138000", "北京市朝阳区建国路1号", 1, 12, "北京集订分送"],
        ["王五", "13712345678", "广东省广州市天河区体育西路100号", 1, 12, ""],
    ])
    batch = _batch(db)
    v = import_svc.create_version(db, batch, [("A", "a.xlsx", a)], operator_id=None)
    batch_svc.activate_version(db, v.id)
    run = gen_svc.generate(db, batch, operator_id=None)

    assert run.status == SubscriptionRunStatus.success
    types = sorted(a.artifact_type.value for a in run.artifacts)
    # workbook + postal_summary + 2 地区 region_detail + zip
    assert types.count("region_detail") == 2
    assert "workbook" in types and "postal_summary" in types and "zip" in types
    assert batch.status == SubscriptionBatchStatus.generated
    # 每个产物有 SHA-256。
    assert all(a.sha256 for a in run.artifacts)


def test_generate_requires_active_version(db):
    from fastapi import HTTPException
    batch = _batch(db)
    with pytest.raises(HTTPException):
        gen_svc.generate(db, batch, operator_id=None)


def test_csv_without_bom_non_utf8_blocks(db):
    # GBK 编码的 CSV（无 BOM）→ 阻断，不猜编码。
    content = "姓名,电话,地址,份数,月数\n张三,13800138000,北京市朝阳区,1,12\n".encode("gbk")
    batch = _batch(db)
    v = import_svc.create_version(db, batch, [("A", "a.csv", content)], operator_id=None)
    assert v.status == SubscriptionImportStatus.validation_failed
    assert any(i.code == "encoding" for i in v.issues)
