"""邮局起投批次服务 · 单元测试（重构后：从投递记录 PostalDelivery 归批）。"""

from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    Partner,
    PartnerType,
    PostalBatchStatus,
    PostalDelivery,
    PostalDeliveryRow,
)
from app.services import postal_batch_service as svc


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


def _delivery(db, no, name, cov_start, cov_end, *, unit_id=None, copies=1,
              channel="CBJ+小程序", address="上海市宝山区华灵路1900弄355号501室",
              province="上海", city="", district="宝山区"):
    rec = PostalDelivery(
        year=cov_start.year, delivery_no=no, recipient_name=name,
        recipient_address=address, recipient_province=province, recipient_city=city,
        recipient_district=district, copies=copies, amount=Decimal("20"),
        coverage_start_date=cov_start, coverage_end_date=cov_end,
        source_channel=channel, distribution_unit_id=unit_id,
    )
    db.add(rec)
    db.flush()
    return rec


def _unit(db, name="北京集订分送"):
    p = Partner(name=name, partner_type=PartnerType.distribution)
    db.add(p)
    db.flush()
    return p.id


def test_generate_groups_by_start_month(db):
    uid = _unit(db)
    _delivery(db, "1", "高占军", date(2026, 1, 1), date(2026, 1, 31), unit_id=uid)
    _delivery(db, "2", "乐骏", date(2026, 1, 10), date(2026, 6, 30))
    _delivery(db, "3", "陈涛", date(2026, 2, 1), date(2026, 2, 28))
    db.commit()

    b1 = svc.generate_batch(db, 2026, 1)
    assert b1.status == PostalBatchStatus.generated
    assert b1.row_count == 2

    b2 = svc.generate_batch(db, 2026, 2)
    assert b2.row_count == 1

    rows = svc.get_batch_rows(db, b1.id)
    assert {r.snap_name for r in rows} == {"高占军", "乐骏"}
    assert all(r.coverage_start_date.month == 1 for r in rows)
    assert any(r.distribution_unit_id == uid for r in rows)
    # 每行溯源到投递记录。
    assert all(r.postal_delivery_id is not None for r in rows)


def test_only_start_month_included(db):
    _delivery(db, "P", "一月甲", date(2026, 1, 1), date(2026, 1, 31))
    _delivery(db, "Q", "二月乙", date(2026, 2, 1), date(2026, 2, 28))
    db.commit()

    b = svc.generate_batch(db, 2026, 1)
    assert b.row_count == 1
    assert svc.get_batch_rows(db, b.id)[0].snap_name == "一月甲"


def test_freeze_carries_notes(db):
    """冻结快照带上投递记录 notes（赠阅/关联等杂项不丢）。"""
    d = _delivery(db, "1", "高占军", date(2026, 1, 1), date(2026, 1, 31))
    d.notes = "赠阅/关联:潘蕊；地区:上海"
    db.commit()
    b = svc.generate_batch(db, 2026, 1)
    assert svc.get_batch_rows(db, b.id)[0].notes == "赠阅/关联:潘蕊；地区:上海"


def test_regenerate_is_idempotent(db):
    _delivery(db, "1", "高占军", date(2026, 1, 1), date(2026, 1, 31))
    db.commit()

    b1 = svc.generate_batch(db, 2026, 1)
    b2 = svc.generate_batch(db, 2026, 1)
    assert b1.id == b2.id
    assert b2.row_count == 1
    total = db.query(PostalDeliveryRow).filter(PostalDeliveryRow.batch_id == b1.id).count()
    assert total == 1  # 重生成清旧行，不累加


def test_sent_batch_is_frozen_and_immutable(db):
    rec = _delivery(db, "1", "高占军", date(2026, 1, 1), date(2026, 1, 31),
                    address="上海市宝山区旧地址1号")
    db.commit()

    batch = svc.generate_batch(db, 2026, 1)
    snap_before = svc.get_batch_rows(db, batch.id)[0].snap_address
    svc.mark_sent(db, batch.id)

    # 事后改投递记录地址
    rec.recipient_address = "上海市浦东新区新地址999号"
    db.commit()

    # 冻结快照不变
    assert svc.get_batch_rows(db, batch.id)[0].snap_address == snap_before

    # 已发批次拒绝重生成
    with pytest.raises(HTTPException) as ei:
        svc.generate_batch(db, 2026, 1)
    assert ei.value.status_code == 409


def test_mark_sent_requires_generated(db):
    batch = svc.get_or_create_batch(db, 2026, 7)  # draft, no rows
    db.commit()
    with pytest.raises(HTTPException) as ei:
        svc.mark_sent(db, batch.id)
    assert ei.value.status_code == 409
