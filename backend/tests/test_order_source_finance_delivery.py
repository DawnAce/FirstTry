"""合成运费：退款、分配、投递边界、撤回和回归。"""
from datetime import date, timedelta, datetime
from decimal import Decimal
import importlib.util
from pathlib import Path
import pytest
from fastapi import HTTPException
from sqlalchemy import inspect
from alembic.migration import MigrationContext
from alembic.operations import Operations
from app.models import PublicationSchedule, Issue, FulfillmentTarget
from app.models.order_source import OrderSourceLink, OrderSourceDeliveryChange, OrderSourceEvent
from app.models.postal_delivery import PostalDelivery
from app.schemas.order_source import SourceRefundIn, SourceDeliveryIn, SourceDeliveryUndoIn
from app.services.order_source_service import candidates, link_source
from app.services import order_source_finance_service as finance, order_source_delivery_service as delivery
from test_order_sources import db, fee_source, subscription, link_request, workbook


def prepared(db):
    source = fee_source(db)
    order, item, target = subscription(db, start=date.today() - timedelta(days=60), end=date.today() + timedelta(days=365))
    link_source(db, source.id, link_request(source, candidates(db, source.id)["rows"]), None)
    for number, days in [(9000, -7), (9001, 7), (9002, 14)]:
        pub = date.today() + timedelta(days=days)
        db.add(PublicationSchedule(year=pub.year, issue_number=number, publish_date=pub, is_suspended=False))
        db.add(Issue(issue_number=number, publish_date=pub, status="draft"))
    postal = PostalDelivery(year=date.today().year, delivery_no="SYNTHETIC-POST", order_id=order.id,
        order_item_id=item.id, fulfillment_target_id=target.id, recipient_name=target.recipient_name,
        recipient_phone=target.recipient_phone, recipient_address=target.recipient_address, copies=1,
        coverage_start_date=item.coverage_start_date, coverage_end_date=item.coverage_end_date)
    db.add(postal)
    db.commit()
    link = db.query(OrderSourceLink).filter_by(source_id=source.id, active=1).one()
    return source, order, item, target, link, postal


def request(source, link, number=9001, channel="zto_outsource"):
    return SourceDeliveryIn(version=source.lock_version, link_id=link.id, effective_from_issue=number,
        shipping_channel=channel, reason="核对合成停投及运费凭据", postal_confirmed=True)


def apply_delivery(db, source, link, number=9001, channel="zto_outsource"):
    data = request(source, link, number, channel)
    data.expected_state = delivery.preview(db, source.id, data)["expected_state"]
    result = delivery.apply(db, source.id, data, None)
    db.commit()
    return result


def test_refund_ledger_does_not_refund_subscription_or_duplicate_payments(db):
    source, order, item, target, link, postal = prepared(db)
    data = SourceRefundIn(version=source.lock_version, amount=41, refunded_at=date.today(), reason="合成部分退款凭据")
    finance.verify_refund(db, source.id, data, None, apply=True)
    db.commit()
    assert source.verified_refund_amount == 41
    assert link.refund_amount == 41
    assert order.paid_amount == 240 and order.refunded_amount == 0 and order.commercial_status is None
    summary = finance.finance_summary(db, order.id)
    assert summary["fee_net_amount"] == 100
    assert summary["combined_net_amount"] == 340
    assert finance.finance_summary(db)["fee_paid_amount"] == 141
    with pytest.raises(HTTPException) as error:
        finance.verify_refund(db, source.id, data, None, apply=True)
    assert error.value.status_code == 409
    with pytest.raises(HTTPException):
        finance.verify_refund(db, source.id, data.model_copy(update={"version": source.lock_version, "amount": Decimal(142)}), None)


def test_refund_split_must_cover_every_target_and_total(db):
    source = fee_source(db, "卖家已退款")
    first, _, _ = subscription(db)
    second, _, _ = subscription(db, "SYNTHETIC-SECOND")
    link_source(db, source.id, link_request(source, candidates(db, source.id)["rows"], [70, 71]), None)
    db.commit()
    links = db.query(OrderSourceLink).order_by(OrderSourceLink.id).all()
    data = SourceRefundIn(version=source.lock_version, amount=141, refunded_at=date.today(), reason="合成全退")
    with pytest.raises(HTTPException):
        finance.verify_refund(db, source.id, data, None)
    data = SourceRefundIn.model_validate({**data.model_dump(), "allocations": [dict(link_id=link.id, amount=link.amount) for link in links]})
    finance.verify_refund(db, source.id, data, None, apply=True)
    db.commit()
    assert finance.finance_summary(db, first.id)["fee_net_amount"] == 0
    assert finance.finance_summary(db, second.id)["fee_net_amount"] == 0
    assert finance.finance_summary(db)["fee_count"] == 1


def test_source_updates_invalidate_financial_aggregation(db):
    from app.services.cbj_order_import_service import preview_import, commit_import, BatchSettings
    source, order, item, target, link, postal = prepared(db)
    _, sid = preview_import(db, workbook(amount=150), BatchSettings(mode="historical"))
    commit_import(db, sid, confirmed_source_updates=[source.external_order_no])
    assert finance.finance_summary(db, order.id)["combined_net_amount"] is None
    assert finance.finance_state(source, [link])["allocation_valid"] is False
    with pytest.raises(HTTPException):
        delivery.preview(db, source.id, request(source, link))


def test_delivery_preserves_history_cuts_postal_and_can_undo(db):
    from app.services.order_shipping_sync_service import preview_order_shipping_sync
    from app.services.postal_renewal_service import list_renewals
    source, order, item, old, link, postal = prepared(db)
    original_end = postal.coverage_end_date
    data = request(source, link)
    preview = delivery.preview(db, source.id, data)
    assert preview["postal_records"][0]["required"] is True
    assert db.query(OrderSourceDeliveryChange).count() == 0
    data.expected_state = preview["expected_state"]
    delivery.apply(db, source.id, data, None)
    db.commit()
    db.expire_all()
    new = db.get(FulfillmentTarget, link.target_id)
    assert new.id != old.id and new.quantity == old.quantity == 1
    assert old.effective_until_issue == 9000 and new.effective_from_issue == 9001
    assert item.delivery_method.value == "post_office"  # 原订阅商业产品属性未覆盖。
    assert postal.coverage_end_date == date.today() + timedelta(days=6)
    assert preview_order_shipping_sync(db, order.id, 9000).summary.to_create == 0
    assert preview_order_shipping_sync(db, order.id, 9001).summary.to_create == 1
    next_month = (date.today() + timedelta(days=45)).strftime("%Y-%m")
    assert all(row["fulfillment_target_id"] != old.id for row in list_renewals(db, next_month)["rows"])
    change = db.query(OrderSourceDeliveryChange).one()
    undo = SourceDeliveryUndoIn(version=source.lock_version, change_id=change.id, reason="合成撤回，邮局尚未停投")
    undo.expected_state = delivery.undo(db, source.id, undo, None)["expected_state"]
    delivery.undo(db, source.id, undo, None, apply=True)
    db.commit()
    assert change.status == "reverted" and new.status.value == "suspended"
    assert postal.coverage_end_date == original_end and old.effective_until_issue is None
    assert link.target_id == old.id
    assert db.query(OrderSourceEvent).filter_by(action="delivery_reverted").count() == 1


def test_forward_correction_keeps_previous_zto_period(db):
    from app.services.order_shipping_sync_service import preview_order_shipping_sync
    source, order, item, old, link, postal = prepared(db)
    apply_delivery(db, source, link)
    first_zto = link.target_id
    apply_delivery(db, source, link, 9002, "post_office")
    db.expire_all()
    assert db.get(FulfillmentTarget, first_zto).effective_until_issue == 9001
    assert preview_order_shipping_sync(db, order.id, 9001).summary.to_create == 1
    assert preview_order_shipping_sync(db, order.id, 9002).summary.to_create == 0
    restored = db.query(PostalDelivery).filter(PostalDelivery.id != postal.id).one()
    assert restored.coverage_start_date == date.today() + timedelta(days=14)
    assert restored.amount is None  # 不再制造订阅收入。


def test_delivery_blocks_refund_finalized_past_missing_dates_and_stale_postal(db):
    source, order, item, target, link, postal = prepared(db)
    data = request(source, link)
    data.expected_state = delivery.preview(db, source.id, data)["expected_state"]
    postal.recipient_address = "合成新地址"
    db.commit()
    with pytest.raises(HTTPException) as error:
        delivery.apply(db, source.id, data, None)
    assert error.value.status_code == 409
    assert db.query(OrderSourceDeliveryChange).count() == 0
    with pytest.raises(HTTPException):
        delivery.preview(db, source.id, request(source, link, 9000))
    source.commercial_status = "refunded"
    db.commit()
    with pytest.raises(HTTPException):
        delivery.preview(db, source.id, request(source, link))
    source.commercial_status = "shipped"
    issue = db.query(Issue).filter_by(issue_number=9001).one()
    issue.status = "confirmed"
    db.commit()
    with pytest.raises(HTTPException):
        delivery.preview(db, source.id, request(source, link))


def test_existing_shipping_blocks_conversion_and_undo(db):
    from app.models.shipping_detail import ShippingDetail
    source, order, item, old, link, postal = prepared(db)
    apply_delivery(db, source, link)
    row = ShippingDetail(issue_number=9001, sheet_name="合成", channel="合成", name=old.recipient_name,
        address=old.recipient_address, quantity=1, order_id=order.id, order_item_id=item.id,
        fulfillment_target_id=link.target_id)
    db.add(row)
    db.commit()
    change = db.query(OrderSourceDeliveryChange).one()
    with pytest.raises(HTTPException):
        delivery.undo(db, source.id, SourceDeliveryUndoIn(version=source.lock_version, change_id=change.id, reason="合成"), None)
    assert row.shipped_at is None  # 连未执行的计划也要求先显式处理。


def test_mixed_progress_counts_postal_then_actual_zto_without_double_count(db):
    from app.services.order_delivery_progress import mixed_progresses
    from app.models.shipping_detail import ShippingDetail
    source, order, item, old, link, postal = prepared(db)
    apply_delivery(db, source, link)
    future = date.today() + timedelta(days=15)
    assert mixed_progresses(db, [item], future)[item.id][1] == 1
    db.add(ShippingDetail(issue_number=9001, sheet_name="合成", channel="合成", name="合成订户", quantity=1,
        order_id=order.id, order_item_id=item.id, fulfillment_target_id=link.target_id, shipped_at=datetime.now()))
    db.commit()
    assert mixed_progresses(db, [item], future)[item.id][1] == 2


def test_delivery_migration_round_trip(db):
    from sqlalchemy import MetaData, Table, Column, Integer, create_engine
    path = Path(__file__).resolve().parents[1] / "alembic/versions/b8d0f2a4c6e9_source_delivery_history.py"
    spec = importlib.util.spec_from_file_location("source_delivery_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    metadata = MetaData()
    for name in ("users", "order_sources", "order_source_links", "fulfillment_targets"):
        Table(name, metadata, Column("id", Integer, primary_key=True))
    metadata.create_all(engine)
    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        assert {c["name"] for c in inspect(connection).get_columns("order_source_delivery_changes")} == set(OrderSourceDeliveryChange.__table__.columns.keys())
        migration.downgrade()
        assert "order_source_delivery_changes" not in inspect(connection).get_table_names()
        migration.upgrade()


def test_legacy_postal_default_zto_target_can_be_converted(db):
    from app.models.fulfillment_target import ShippingChannel
    source, order, item, old, link, postal = prepared(db)
    old.shipping_channel = ShippingChannel.zto_outsource  # 既有默认值，实际按明细走邮局。
    db.commit()
    assert delivery.options(db, source.id, link.id)["shipping_channel"] == "post_office"
    apply_delivery(db, source, link)
    assert old.shipping_channel == ShippingChannel.post_office
    assert db.get(FulfillmentTarget, link.target_id).shipping_channel == ShippingChannel.zto_outsource


def test_refund_known_before_reimport_becomes_pending_not_zero(db):
    from app.services.cbj_order_import_service import preview_import, commit_import, BatchSettings
    source, order, item, target, link, postal = prepared(db)
    finance.verify_refund(db, source.id, SourceRefundIn(version=source.lock_version, amount=10, refunded_at=date.today(), reason="合成"), None, apply=True)
    db.commit()
    _, sid = preview_import(db, workbook(amount=150), BatchSettings(mode="historical"))
    commit_import(db, sid, confirmed_source_updates=[source.external_order_no])
    assert finance.finance_summary(db)["fee_net_amount"] is None
    assert finance.finance_state(source, [link])["refund_pending"] is True


def test_delivery_api_is_admin_only_rechecks_version_and_rolls_back(db):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.auth import get_current_user
    from app.database import get_db
    from app.models import User, UserRole
    source, order, item, target, link, postal = prepared(db)
    user = User(username="synthetic-operator", password_hash="unused", role=UserRole.viewer)
    db.add(user); db.commit()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        client = TestClient(app)
        body = request(source, link).model_dump(mode="json")
        url = f"/api/order-sources/{source.id}"
        assert client.post(url + "/delivery", json=body).status_code == 403
        assert client.put(url + "/refund", json={"version": source.lock_version, "amount": 0, "reason": "合成"}).status_code == 403
        user.role = UserRole.admin; db.commit()
        review = client.post(url + "/delivery-preview", json=body)
        assert review.status_code == 200
        body["expected_state"] = review.json()["expected_state"]
        body["postal_confirmed"] = False
        assert client.post(url + "/delivery", json=body).status_code == 422
        assert db.query(OrderSourceDeliveryChange).count() == 0
        assert target.effective_until_issue is None
        body["postal_confirmed"] = True
        saved = client.post(url + "/delivery", json=body)
        assert saved.status_code == 200
        assert len(saved.json()["delivery_changes"]) == 1
        assert saved.json()["events"][0]["action"] == "delivery_applied"
        assert client.post(url + "/delivery", json=body).status_code == 409
        assert db.query(OrderSourceDeliveryChange).count() == 1
    finally:
        app.dependency_overrides.clear()


def test_delivery_history_blocks_generic_item_removal(db):
    from app.schemas.order import OrderItemsUpdate, OrderItemUpdate
    from app.services.order_service import update_order_items
    source, order, item, old, link, postal = prepared(db)
    apply_delivery(db, source, link)
    with pytest.raises(HTTPException) as error:
        update_order_items(db, order.id, OrderItemsUpdate(items=[OrderItemUpdate(fulfillment_type="gift", total_quantity=1)], effective_from_issue=9002, change_reason="合成删除"))
    assert error.value.status_code == 409
    assert item.status.value == "active"


def test_financial_reallocation_preserves_delivery_link_and_history(db):
    from app.services.cbj_order_import_service import preview_import, commit_import, BatchSettings
    source, order, item, target, link, postal = prepared(db)
    apply_delivery(db, source, link)
    link_id = link.id
    _, sid = preview_import(db, workbook(amount=150), BatchSettings(mode="historical"))
    commit_import(db, sid, confirmed_source_updates=[source.external_order_no])
    rows = candidates(db, source.id)["rows"]
    link_source(db, source.id, link_request(source, rows), None)
    db.commit()
    assert link.id == link_id and link.delivery_from_issue == 9001 and link.amount == 150
    finance.verify_refund(db, source.id, SourceRefundIn(version=source.lock_version, amount=0, reason="合成金额修正，未退款"), None, apply=True)
    db.commit()
    assert finance.finance_summary(db, order.id)["fee_net_amount"] == 150


def test_delivery_target_structure_cannot_be_overwritten_but_price_can_change(db):
    from app.schemas.order import OrderItemsUpdate, OrderItemUpdate, FulfillmentTargetIn
    from app.services.order_service import update_order_items
    source, order, item, old, link, postal = prepared(db)
    apply_delivery(db, source, link)
    target = db.get(FulfillmentTarget, link.target_id)
    row = OrderItemUpdate(id=item.id, publication=item.publication, publication_format=item.publication_format,
        fulfillment_type=item.fulfillment_type, billing_type=item.billing_type, subscription_term=item.subscription_term,
        delivery_method=item.delivery_method, coverage_start_date=item.coverage_start_date, coverage_end_date=item.coverage_end_date,
        total_quantity=1, unit_price=241, subtotal=241, targets=[FulfillmentTargetIn(
            recipient_name=target.recipient_name, recipient_phone=target.recipient_phone, recipient_address=target.recipient_address,
            recipient_postal_code=target.recipient_postal_code, quantity=1, shipping_channel=target.shipping_channel,
            effective_from_issue=target.effective_from_issue, effective_until_issue=target.effective_until_issue, notes=target.notes)])
    bad = row.model_copy(update={"coverage_end_date": item.coverage_end_date + timedelta(days=1)})
    with pytest.raises(HTTPException) as error:
        update_order_items(db, order.id, OrderItemsUpdate(items=[bad], effective_from_issue=9002))
    assert error.value.status_code == 409
    db.rollback()
    update_order_items(db, order.id, OrderItemsUpdate(items=[row], effective_from_issue=9002))
    db.commit()
    assert item.unit_price == 241
    assert db.get(FulfillmentTarget, link.target_id).effective_from_issue == 9001


def test_fully_refunded_allocation_cannot_start_zto_when_other_allocation_has_balance(db):
    source, order, item, old, link, postal = prepared(db)
    subscription(db, "SYNTHETIC-SECOND")
    link_source(db, source.id, link_request(source, candidates(db, source.id)["rows"], [70, 71]), None)
    db.commit()
    links = db.query(OrderSourceLink).filter_by(source_id=source.id, active=1).all()
    fully_refunded = next(link for link in links if link.amount == 70)
    data = SourceRefundIn(version=source.lock_version, amount=70, refunded_at=date.today(), reason="合成单目标全退",
        allocations=[{"link_id": link.id, "amount": 70 if link.id == fully_refunded.id else 0} for link in links])
    finance.verify_refund(db, source.id, data, None, apply=True)
    db.commit()
    assert finance.finance_summary(db)["fee_net_amount"] == 71
    with pytest.raises(HTTPException) as error:
        delivery.preview(db, source.id, request(source, fully_refunded))
    assert error.value.status_code == 409


def test_unknown_source_status_requires_financial_verification(db):
    source = fee_source(db, "合成待人工核对状态")
    assert source.finance_review_required is True
    assert finance.finance_summary(db)["fee_net_amount"] is None


def test_changing_one_of_many_recipients_preserves_other_postal_targets(db):
    from app.services.order_delivery_progress import mixed_progresses
    from app.models.shipping_detail import ShippingDetail
    source, order, item, old, link, postal = prepared(db)
    item.total_quantity = 2
    other = FulfillmentTarget(order_item_id=item.id, allocation_id=old.allocation_id, quantity=1,
        recipient_name="合成另一订户", recipient_address="合成另一地址", shipping_channel="zto_outsource")
    db.add(other); db.flush()
    db.add(PostalDelivery(year=date.today().year, delivery_no="SYNTHETIC-OTHER", order_id=order.id,
        order_item_id=item.id, fulfillment_target_id=other.id, copies=1, recipient_name=other.recipient_name,
        recipient_address=other.recipient_address, coverage_start_date=item.coverage_start_date, coverage_end_date=item.coverage_end_date))
    db.commit()
    apply_delivery(db, source, link)
    db.add(ShippingDetail(issue_number=9001, sheet_name="合成", channel="合成", name="合成订户", quantity=1,
        order_id=order.id, order_item_id=item.id, fulfillment_target_id=link.target_id, shipped_at=datetime.now()))
    db.commit()
    assert mixed_progresses(db, [item], date.today() + timedelta(days=15))[item.id][1] == 2
    apply_delivery(db, source, link, 9002, "post_office")
    assert db.query(PostalDelivery).count() == 3


def test_undo_snapshot_is_durable_without_existing_postal_record(db):
    source, order, item, old, link, postal = prepared(db)
    db.delete(postal); db.commit()
    apply_delivery(db, source, link)
    db.expire_all()
    change = db.query(OrderSourceDeliveryChange).one()
    assert "after_target" in change.previous_state
    data = SourceDeliveryUndoIn(version=source.lock_version, change_id=change.id, reason="合成撤回")
    data.expected_state = delivery.undo(db, source.id, data, None)["expected_state"]
    delivery.undo(db, source.id, data, None, apply=True)
    db.commit()
    assert link.target_id == old.id
