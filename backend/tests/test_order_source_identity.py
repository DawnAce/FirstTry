"""销售来源标准化及跨入口去重，全部使用合成数据。"""
import io
from datetime import date

import pytest
from fastapi import HTTPException
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Order, OrderEntryMethod, OrderStatus
from app.models.order_source import OrderSource, OrderSourceLink, OrderSourceVersion
from app.seeds.products import seed_products
from app.services.cbj_order_import_service import BatchSettings, commit_import, preview_import


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        seed_products(session)
        yield session
    engine.dispose()


def workbook(number="SYNTHETIC-IDENTITY"):
    wb = Workbook()
    wb.active.append(["订单号", "产品名称", "付款金额", "地址", "订单状态", "下单时间"])
    wb.active.append([number, "《中国经营报》全年订阅-618促销活动X1,单价:199", 199,
                      "合成订户,00000000000,合成路1号", "卖家已发货", "2026-06-01 12:00:00"])
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def order(db, platform="微信小程序", store="CBJ+"):
    row = Order(order_date=date(2026, 6, 1), external_order_no="SYNTHETIC-IDENTITY",
                source_platform=platform, source_store=store, entry_method=OrderEntryMethod.manual,
                payer_name="合成订户", status=OrderStatus.active, paid_amount=199, total_amount=199)
    db.add(row)
    db.commit()
    return row


def test_manual_then_import_only_adds_source(db):
    existing = order(db)
    result, sid = preview_import(db, workbook(), BatchSettings(mode="historical"))
    assert result["rows"][0]["decision"] == "retain"
    saved = commit_import(db, sid)
    assert saved["created"] == 0
    assert db.query(Order).count() == 1
    assert db.query(OrderSourceLink).one().order_id == existing.id
    assert db.query(OrderSource).one().platform == "微信小程序"
    assert db.query(OrderSource).one().store == "CBJ+"


def test_multiple_alias_orders_block_instead_of_choosing(db):
    order(db)
    order(db, "CBJ小程序", None)
    result, _ = preview_import(db, workbook(), BatchSettings(mode="historical"))
    assert result["rows"][0]["decision"] == "unresolved"
    assert "来源身份冲突" in result["rows"][0]["reason"]
    assert result["can_commit"] is False


def test_commit_rechecks_manual_order_created_after_preview(db):
    _, sid = preview_import(db, workbook(), BatchSettings(mode="historical"))
    existing = order(db)
    result = commit_import(db, sid)
    assert result["created"] == 0
    assert db.query(OrderSourceLink).one().order_id == existing.id


def test_same_number_on_other_platform_is_independent(db):
    order(db, "淘宝", "中国经营报发行部")
    _, sid = preview_import(db, workbook(), BatchSettings(mode="historical"))
    assert commit_import(db, sid)["created"] == 1


def test_legacy_source_reimport_preserves_original_snapshot(db):
    _, sid = preview_import(db, workbook(), BatchSettings(mode="historical"))
    commit_import(db, sid)
    source = db.query(OrderSource).one()
    source.platform, source.store = "CBJ小程序", ""
    version = db.query(OrderSourceVersion).one()
    snapshot = {**version.snapshot, "platform": "CBJ小程序", "store": ""}
    version.snapshot = snapshot
    db.commit()
    result, _ = preview_import(db, workbook(), BatchSettings(mode="historical"))
    assert result["rows"][0]["decision"] == "duplicate"
    assert db.query(OrderSourceVersion).one().snapshot == snapshot


def test_conflict_created_after_preview_rolls_back(db):
    _, sid = preview_import(db, workbook(), BatchSettings(mode="historical"))
    order(db)
    order(db, "CBJ小程序", None)
    with pytest.raises(HTTPException) as exc:
        commit_import(db, sid)
    assert exc.value.status_code == 409
    assert db.query(OrderSource).count() == 0


def test_known_platform_rejects_wrong_store():
    from app.services.order_source_identity import normalize_source
    with pytest.raises(HTTPException) as exc:
        normalize_source('微信小程序', '中国经营报发行部', validate=True)
    assert exc.value.status_code == 422
    assert normalize_source('CBJ小程序', None, validate=True) == ('微信小程序', 'CBJ+')
    assert normalize_source('商学院有赞', None) == ('商学院有赞', None)


def test_manual_create_also_blocks_imported_identity(db):
    from app.order_import_cache import get_order_import_session
    from app.schemas.order import OrderCreate
    from app.services.order_service import create_order_draft
    _, sid = preview_import(db, workbook(), BatchSettings(mode='historical'))
    data = OrderCreate(**get_order_import_session(sid)['rows'][0]['order_create'])
    order(db, 'CBJ小程序', None)
    with pytest.raises(HTTPException) as exc:
        create_order_draft(db, data)
    assert exc.value.status_code == 409
    assert db.query(Order).count() == 1
