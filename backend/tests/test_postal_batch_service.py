"""邮局起投批次服务 · 单元测试（Task 4）。"""

from datetime import date
from decimal import Decimal

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
    Partner,
    PartnerType,
    PostalBatchStatus,
    PostalDeliveryRow,
    Publication,
    PublicationFormat,
    ShippingChannel,
)
from app.schemas.order import FulfillmentTargetIn, OrderCreate, OrderItemIn
from app.services import postal_batch_service as svc
from app.services.order_service import create_imported_order


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


def _order(db, ext, name, cov_start, cov_end, code, *, unit_id=None, qty=1,
           delivery=DeliveryMethod.post_office, channel=ShippingChannel.post_office,
           address="上海市宝山区华灵路1900弄355号501室"):
    oc = OrderCreate(
        external_order_no=ext,
        order_date=cov_start,
        payer_name=name,
        total_amount=Decimal("20"),
        paid_amount=Decimal("20"),
        items=[
            OrderItemIn(
                publication=Publication.cbj,
                publication_format=PublicationFormat.paper,
                fulfillment_type=FulfillmentType.subscription,
                billing_type=BillingType.paid,
                delivery_method=delivery,
                coverage_start_date=cov_start,
                coverage_end_date=cov_end,
                total_quantity=qty,
                unit_price=Decimal("20"),
                subtotal=Decimal("20"),
                targets=[
                    FulfillmentTargetIn(
                        recipient_name=name,
                        recipient_address=address,
                        quantity=qty,
                        shipping_channel=channel,
                        distribution_unit_id=unit_id,
                    )
                ],
            )
        ],
    )
    return create_imported_order(db, oc, order_code=code)


def _unit(db, name="北京集订分送"):
    p = Partner(name=name, partner_type=PartnerType.distribution)
    db.add(p)
    db.flush()
    return p.id


def test_generate_groups_by_start_month(db):
    uid = _unit(db)
    _order(db, "2026-1", "高占军", date(2026, 1, 1), date(2026, 1, 31), "C1", unit_id=uid)
    _order(db, "2026-2", "乐骏", date(2026, 1, 10), date(2026, 6, 30), "C2")
    _order(db, "2026-3", "陈涛", date(2026, 2, 1), date(2026, 2, 28), "C3")
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


def test_only_post_office_included(db):
    _order(db, "2026-P", "邮局甲", date(2026, 1, 1), date(2026, 1, 31), "P1")
    _order(db, "2026-Z", "中通乙", date(2026, 1, 1), date(2026, 1, 31), "Z1",
           delivery=DeliveryMethod.zto_mf, channel=ShippingChannel.zto_outsource)
    db.commit()

    b = svc.generate_batch(db, 2026, 1)
    assert b.row_count == 1
    assert svc.get_batch_rows(db, b.id)[0].snap_name == "邮局甲"


def test_regenerate_is_idempotent(db):
    _order(db, "2026-1", "高占军", date(2026, 1, 1), date(2026, 1, 31), "C1")
    db.commit()

    b1 = svc.generate_batch(db, 2026, 1)
    b2 = svc.generate_batch(db, 2026, 1)
    assert b1.id == b2.id
    assert b2.row_count == 1
    total = db.query(PostalDeliveryRow).filter(PostalDeliveryRow.batch_id == b1.id).count()
    assert total == 1  # 重生成清旧行，不累加


def test_sent_batch_is_frozen_and_immutable(db):
    _order(db, "2026-1", "高占军", date(2026, 1, 1), date(2026, 1, 31), "C1",
           address="上海市宝山区旧地址1号")
    db.commit()

    batch = svc.generate_batch(db, 2026, 1)
    snap_before = svc.get_batch_rows(db, batch.id)[0].snap_address
    svc.mark_sent(db, batch.id)

    # 事后改订单收报人地址
    tgt = db.query(FulfillmentTarget).first()
    tgt.recipient_address = "上海市浦东新区新地址999号"
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
