"""业务边界：订单状态与导入结果独立，交叉条件按优先级只计入一类。

对应 docs/order-import-decision-rules.md；仅使用合成商品、订单及 SQLite 内存库。
"""

import io
from datetime import date, datetime
from decimal import Decimal
from typing import Iterator

import pytest
from fastapi import HTTPException
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Order, OrderCommercialStatus, OrderEntryMethod, OrderStatus
from app.models.order_item import DeliveryMethod, FulfillmentType, Publication, SubscriptionTerm
from app.models.product import Product
from app.models.order_source import OrderSource, OrderSourceVersion
from app.services.cbj_order_import_parser import ParsedOrder, ProductLine
from app.services.cbj_order_import_service import (
    BatchSettings,
    build_import_preview,
    commit_import,
    preview_import,
)


KNOWN = "合成测试全年纸刊"
UNKNOWN = "待确认合成商品"
IGNORED = "合成电子刊"
SETTINGS = BatchSettings(mode="historical")
DECISIONS = ("import", "retain", "source_update", "duplicate", "unresolved", "skip_status")


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine("sqlite://", poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(Product(
            code="SYNTHETIC-BOUNDARY", display_name=KNOWN,
            publication=Publication.cbj, fulfillment_type=FulfillmentType.subscription,
            subscription_term=SubscriptionTerm.one_year,
            delivery_method=DeliveryMethod.post_office, list_price=Decimal("240"),
        ))
        session.commit()
        yield session
    engine.dispose()


def parsed_order(status: str, kind: str, missing_date: bool) -> ParsedOrder:
    names = {
        "known": [KNOWN], "unknown": [UNKNOWN], "ignored": [IGNORED],
        "known_ignored": [KNOWN, IGNORED], "unknown_ignored": [UNKNOWN, IGNORED],
        "shipping": ["合成运费补拍"], "empty": [],
    }[kind]
    return ParsedOrder(
        external_order_no="SYNTHETIC-BOUNDARY-ORDER", status_raw=status,
        paid_amount=Decimal("240"), original_amount=Decimal("240"),
        order_date=None if missing_date else date(2026, 9, 1),
        payment_time=None if missing_date else datetime(2026, 9, 1, 12),
        payment_method_raw="微信", invoice_raw="", recipient_name="合成测试订户",
        recipient_phone="", recipient_address="合成测试地址", recipient_postal_code=None,
        notes="", product_lines=[ProductLine(
            raw=name, name=name, quantity=1, unit_price=Decimal("240"),
            is_shipping=kind == "shipping", mentions_zto=False,
        ) for name in names],
    )


def existing_order(db: Session, external_order_no: str) -> Order:
    order = Order(
        external_order_no=external_order_no, order_date=date(2026, 8, 1),
        entry_method=OrderEntryMethod.excel_import, payer_name="合成已有订户",
        status=OrderStatus.active, commercial_status=OrderCommercialStatus.shipped,
    )
    db.add(order)
    db.commit()
    return order


def workbook_bytes(orders: list[ParsedOrder], platform: str = "cbj") -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(
        ["订单编号", "商品标题", "总金额", "买家实付金额", "订单状态", "订单创建时间", "宝贝总数量"]
        if platform == "taobao" else
        ["订单号", "产品名称", "原价", "付款金额", "支付方式", "发票",
         "地址", "备注", "下单时间", "支付时间", "订单状态"]
    )
    for order in orders:
        if platform == "taobao":
            sheet.append([order.external_order_no, ",".join(p.name for p in order.product_lines),
                          order.original_amount, order.paid_amount, order.status_raw,
                          order.order_date, sum(p.quantity for p in order.product_lines)])
            continue
        products = "\n".join(f"{p.name}X{p.quantity},单价:{p.unit_price}" for p in order.product_lines)
        sheet.append([order.external_order_no, products, order.original_amount, order.paid_amount,
                      order.payment_method_raw, "", "", "合成测试", order.order_date,
                      order.payment_time, order.status_raw])
    data = io.BytesIO()
    workbook.save(data)
    return data.getvalue()


@pytest.mark.parametrize(
    "status,kind,exists,missing_date,decision,commercial_status,reason,final_decision",
    [
        ("已支付，卖家待发货", "known", False, False, "import", "paid", None, "import"),
        ("卖家已发货", "known", False, False, "import", "shipped", None, "import"),
        ("卖家已退款", "known", False, False, "import", "refunded", None, "import"),
        ("卖家部分退款", "known", False, False, "import", "partial_refund", None, "import"),
        ("卖家已退款", "unknown", False, False, "unresolved", "refunded", "商品库无匹配", "unresolved"),
        ("卖家部分退款", "unknown", False, False, "unresolved", "partial_refund", "商品库无匹配", "unresolved"),
        ("卖家已退款", "known", True, False, "duplicate", "refunded", "订单号已存在", "retain"),
        ("卖家已退款", "unknown", True, True, "duplicate", "refunded", "订单号已存在", "retain"),
        ("待付款", "known", False, False, "skip_status", "pending_payment", "状态", "skip_status"),
        ("已取消", "unknown", True, True, "skip_status", "cancelled", "状态", "skip_status"),
        ("交易关闭", "known", False, False, "skip_status", "cancelled", "状态", "skip_status"),
        ("卖家已退款", "ignored", False, False, "skip_status", "refunded", "已忽略", "skip_status"),
        ("卖家已发货", "ignored", True, False, "duplicate", "shipped", "订单号已存在", "retain"),
        ("卖家已发货", "ignored", False, True, "unresolved", "shipped", "缺少下单/支付时间", "unresolved"),
        ("卖家已退款", "known", False, True, "unresolved", "refunded", "缺少下单/支付时间", "unresolved"),
        ("卖家已退款", "shipping", False, False, "unresolved", "refunded", "无可识别的商品行", "retain"),
        ("卖家已发货", "empty", False, False, "unresolved", "shipped", "无可识别的商品行", "unresolved"),
        ("卖家已发货", "known_ignored", False, False, "import", "shipped", None, "import"),
        ("卖家已发货", "unknown_ignored", False, False, "unresolved", "shipped", "商品库无匹配", "unresolved"),
        ("卖家已退款", "ignored", False, True, "unresolved", "refunded", "缺少下单/支付时间", "unresolved"),
        ("卖家已退款", "empty", False, False, "unresolved", "refunded", "无可识别的商品行", "unresolved"),
    ],
)
def test_decision_priority_and_exclusive_counts(
    db: Session, status: str, kind: str, exists: bool, missing_date: bool,
    decision: str, commercial_status: str, reason: str | None, final_decision: str,
) -> None:
    source = parsed_order(status, kind, missing_date)
    if exists:
        existing_order(db, source.external_order_no)
    preview = build_import_preview(db, [source], SETTINGS)
    row = preview.rows[0]

    assert row.decision == decision
    assert row.commercial_status.value == commercial_status
    assert (row.order_create is not None) == (decision == "import")
    assert row.reason is None if reason is None else reason in row.reason
    assert preview.counts == {
        "total": 1, **{key: int(key == decision)
                       for key in ("import", "skip_status", "duplicate", "unresolved")},
    }
    assert db.query(Order).count() == int(exists)  # 预览本身不建单。

    # 必须同时验证公开预览流程；底层四类只是中间结果。
    final, _ = preview_import(db, workbook_bytes([source]), SETTINGS)
    assert final["rows"][0]["decision"] == final_decision
    assert final["rows"][0]["commercial_status"] == commercial_status
    assert {key: final["counts"].get(key, 0) for key in DECISIONS} == {
        key: int(key == final_decision) for key in DECISIONS
    }
    assert final["counts"]["total"] == 1
    assert final["can_commit"] == (final_decision in {"import", "retain", "source_update"})
    assert db.query(OrderSource).count() == 0
    assert db.query(Order).count() == int(exists)


@pytest.mark.parametrize("status", ["", "合成未知平台状态"])
def test_unknown_status_requires_review_while_retaining_planned_import_decision(db: Session, status: str) -> None:
    row = build_import_preview(db, [parsed_order(status, "known", False)], SETTINGS).rows[0]
    assert row.decision == "import"
    assert row.status_unknown is True
    assert row.commercial_status is None
    assert row.reviews[0]["kind"] == "status"
    # 订期留空不等于待确认；入库资格也不代表发货信息已经完整。
    assert row.order_create.items[0].coverage_start_date is None
    assert row.order_create.items[0].coverage_end_date is None
    final, _ = preview_import(db, workbook_bytes([parsed_order(status, "known", False)]), SETTINGS)
    assert final["rows"][0]["decision"] == "import"
    assert final["rows"][0]["status_unknown"] is True
    assert final["can_commit"] is False


@pytest.mark.parametrize("status", ["待付款", "已取消", "卖家已退款", "卖家已发货"])
@pytest.mark.parametrize("missing_date", [False, True])
def test_pure_fee_retention_precedes_status_and_date_checks(
    db: Session, status: str, missing_date: bool,
) -> None:
    source = parsed_order(status, "shipping", missing_date)
    preview, sid = preview_import(db, workbook_bytes([source]), SETTINGS)
    assert preview["rows"][0]["decision"] == "retain"
    assert "纯运费" in preview["rows"][0]["reason"]
    result = commit_import(db, sid)
    assert result["created"] == 0
    assert result["retained_sources"] == 1
    retained = db.query(OrderSource).one()
    assert retained.kind == "shipping_fee"
    assert retained.commercial_status == preview["rows"][0]["commercial_status"]
    assert db.query(Order).count() == 0


@pytest.mark.parametrize("status,kind,missing_date", [
    ("已取消", "known", False), ("待付款", "unknown", True),
    ("卖家已退款", "ignored", False), ("卖家已退款", "unknown", True),
    ("卖家已发货", "shipping", False),
])
def test_existing_source_comparison_precedes_order_eligibility(
    db: Session, status: str, kind: str, missing_date: bool,
) -> None:
    original = parsed_order("卖家已发货", "known", False)
    _, sid = preview_import(db, workbook_bytes([original]), SETTINGS)
    commit_import(db, sid)
    changed = parsed_order(status, kind, missing_date)
    preview, sid = preview_import(db, workbook_bytes([changed]), SETTINGS)
    assert preview["rows"][0]["decision"] == "source_update"
    assert preview["rows"][0]["previous_snapshot"]["status_raw"] == "卖家已发货"
    with pytest.raises(HTTPException) as error:
        commit_import(db, sid)
    assert error.value.status_code == 409
    assert db.query(OrderSourceVersion).count() == 1
    commit_import(db, sid, confirmed_source_updates=[changed.external_order_no])
    assert db.query(OrderSourceVersion).count() == 2
    assert db.query(Order).one().commercial_status == OrderCommercialStatus.shipped


@pytest.mark.parametrize("platform,store,decision", [
    ("CBJ小程序", None, "retain"), (None, None, "retain"),
    ("淘宝", None, "import"), ("CBJ小程序", "合成其他店铺", "import"),
])
def test_existing_business_order_is_scoped_by_platform_and_store(
    db: Session, platform: str | None, store: str | None, decision: str,
) -> None:
    source = parsed_order("卖家已退款", "known", False)
    old = existing_order(db, source.external_order_no)
    old.source_platform, old.source_store = platform, store
    db.commit()
    preview, _ = preview_import(db, workbook_bytes([source]), SETTINGS)
    assert preview["rows"][0]["decision"] == decision


def test_unchanged_source_is_duplicate_even_when_cancelled(db: Session) -> None:
    source = parsed_order("已取消", "shipping", True)
    data = workbook_bytes([source])
    _, sid = preview_import(db, data, SETTINGS, filename="synthetic-original.xlsx")
    commit_import(db, sid)
    preview, _ = preview_import(db, data, SETTINGS, filename="synthetic-renamed.xlsx")
    assert preview["rows"][0]["decision"] == "duplicate"
    assert preview["can_commit"] is False
    assert db.query(OrderSourceVersion).count() == 1
    assert db.query(Order).count() == 0


def test_payment_date_is_a_valid_fallback(db: Session) -> None:
    source = parsed_order("卖家已退款", "known", False)
    source.order_date = None
    preview, sid = preview_import(db, workbook_bytes([source]), SETTINGS)
    assert preview["rows"][0]["decision"] == "import"
    commit_import(db, sid)
    assert db.query(Order).one().order_date == date(2026, 9, 1)


@pytest.mark.parametrize("status", ["卖家已退款", "卖家部分退款"])
@pytest.mark.parametrize("platform", ["cbj", "taobao"])
def test_refund_can_be_resolved_after_other_rows_are_imported(
    db: Session, status: str, platform: str,
) -> None:
    refund = parsed_order(status, "unknown", False)
    ready = parsed_order("卖家已发货", "known", False)
    ready.external_order_no = "SYNTHETIC-READY"
    content = workbook_bytes([refund, ready], platform)
    preview, sid = preview_import(db, content, SETTINGS, filename="synthetic-refund.xlsx")
    row = preview["rows"][0]
    assert row["decision"] == "unresolved"
    assert row["unresolved_product"] == UNKNOWN
    assert "商品库无匹配" in row["reason"]
    assert row["source_snapshot"]["status_raw"] == status
    assert commit_import(db, sid)["created"] == 1
    assert db.query(OrderSource).count() == 1  # 待确认不能提前变成已导入来源。

    product = db.query(Product).one()
    product.aliases = [UNKNOWN]
    db.commit()
    preview, sid = preview_import(db, content, SETTINGS, filename="synthetic-refund.xlsx")
    assert [row["decision"] for row in preview["rows"]] == ["import", "duplicate"]
    result = commit_import(db, sid)
    assert result["created"] == 1
    assert result["retained_sources"] == 0
    order = db.query(Order).filter_by(external_order_no=refund.external_order_no).one()
    assert order.commercial_status.value == preview["rows"][0]["commercial_status"]
    source = db.query(OrderSource).filter_by(external_order_no=refund.external_order_no).one()
    original = db.query(OrderSourceVersion).filter_by(source_id=source.id).one()
    assert original.snapshot["filename"] == "synthetic-refund.xlsx"
    assert original.snapshot["status_raw"] == status
    assert original.snapshot["product_lines"][0]["name"] == UNKNOWN
    assert db.query(Order).count() == db.query(OrderSource).count() == 2


def test_duplicate_source_numbers_in_one_file_fail_before_confirmation(db: Session) -> None:
    source = parsed_order("卖家已退款", "known", False)
    with pytest.raises(ValueError, match="同一文件存在重复来源单号"):
        preview_import(db, workbook_bytes([source, source]), SETTINGS)
    assert db.query(Order).count() == db.query(OrderSource).count() == 0


def test_six_decisions_survive_excel_preview_and_atomic_commit(db: Session) -> None:
    old = existing_order(db, "SYNTHETIC-LEGACY")
    old.source_platform = "CBJ小程序"
    db.commit()
    seeds = []
    for external_no in ("SYNTHETIC-DUPLICATE", "SYNTHETIC-UPDATE"):
        seed = parsed_order("卖家已发货", "known", False)
        seed.external_order_no = external_no
        seeds.append(seed)
    _, sid = preview_import(db, workbook_bytes(seeds), SETTINGS)
    commit_import(db, sid)

    cases = [
        ("SYNTHETIC-REFUNDED", "known", "卖家已退款", "import"),
        ("SYNTHETIC-PARTIAL", "known", "卖家部分退款", "import"),
        ("SYNTHETIC-FEE", "shipping", "卖家已退款", "retain"),
        ("SYNTHETIC-REFUND-UNRESOLVED", "unknown", "卖家已退款", "unresolved"),
        ("SYNTHETIC-LEGACY", "known", "卖家已退款", "retain"),
        ("SYNTHETIC-PENDING", "known", "待付款", "skip_status"),
        ("SYNTHETIC-IGNORED", "ignored", "卖家已退款", "skip_status"),
        ("SYNTHETIC-UNRESOLVED", "unknown", "卖家已发货", "unresolved"),
        ("SYNTHETIC-DUPLICATE", "known", "卖家已发货", "duplicate"),
        ("SYNTHETIC-UPDATE", "known", "卖家已退款", "source_update"),
    ]
    sources = []
    for external_no, kind, status, _ in cases:
        source = parsed_order(status, kind, False)
        source.external_order_no = external_no
        sources.append(source)
    preview, session_id = preview_import(db, workbook_bytes(sources), SETTINGS)
    assert preview["counts"] == {
        "total": 10, "import": 2, "retain": 2, "source_update": 1,
        "skip_status": 2, "duplicate": 1, "unresolved": 2,
    }
    assert {row["external_order_no"]: row["decision"] for row in preview["rows"]} == {
        external_no: decision for external_no, _, _, decision in cases
    }
    assert preview["can_commit"] is True
    assert db.query(Order).count() == 3
    assert db.query(OrderSource).count() == 2

    # 未核对来源更新时，整批阻断；不能先写入同批可导入和留存行。
    with pytest.raises(HTTPException) as error:
        commit_import(db, session_id)
    assert error.value.status_code == 409
    assert db.query(Order).count() == 3
    assert db.query(OrderSourceVersion).count() == 2
    result = commit_import(db, session_id, confirmed_source_updates=["SYNTHETIC-UPDATE"])
    assert result["created"] == 2
    assert result["retained_sources"] == 2
    assert result["skipped_duplicates"] == 0  # 预览重复不计入确认阶段新增重复。
    assert {order.external_order_no: order.commercial_status for order in db.query(Order).all()} == {
        "SYNTHETIC-REFUNDED": OrderCommercialStatus.refunded,
        "SYNTHETIC-PARTIAL": OrderCommercialStatus.partial_refund,
        "SYNTHETIC-LEGACY": OrderCommercialStatus.shipped,
        "SYNTHETIC-DUPLICATE": OrderCommercialStatus.shipped,
        "SYNTHETIC-UPDATE": OrderCommercialStatus.shipped,
    }
    retained = {source.external_order_no: source for source in db.query(OrderSource).all()}
    assert set(retained) == {
        "SYNTHETIC-REFUNDED", "SYNTHETIC-PARTIAL", "SYNTHETIC-FEE",
        "SYNTHETIC-LEGACY", "SYNTHETIC-DUPLICATE", "SYNTHETIC-UPDATE",
    }
    assert retained["SYNTHETIC-UPDATE"].commercial_status == "refunded"
    assert retained["SYNTHETIC-UPDATE"].revision == 2
    assert retained["SYNTHETIC-DUPLICATE"].revision == 1
    assert db.query(OrderSourceVersion).count() == 7
    db.refresh(old)
    assert old.payer_name == "合成已有订户"
