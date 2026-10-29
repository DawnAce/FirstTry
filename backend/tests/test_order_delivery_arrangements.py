"""按期投递及运费关联使用合成数据和 SQLite。"""
from datetime import date, timedelta

import pytest
from fastapi import HTTPException

from app.models import Issue, PublicationSchedule
from app.models.fulfillment_target import ShippingChannel
from app.models.order_source import OrderSourceDeliveryChange, OrderSourceLink
from app.schemas.order_source import SourceLinkIn
from app.services.order_shipping_sync_service import preview_order_shipping_sync
from app.services.order_source_service import candidates
from test_order_sources import db, subscription, fee_source, link_request
from test_order_import_review_workflow import env, preview as import_preview, commit as import_commit, POSTAL, FEE


def schedules(db):
    for number, days in [(9101, 7), (9102, 14), (9103, 21)]:
        published = date.today() + timedelta(days=days)
        db.add(PublicationSchedule(year=published.year, issue_number=number, publish_date=published, is_suspended=False))
        db.add(Issue(issue_number=number, publish_date=published, status="draft"))
    db.commit()


def test_legacy_postal_default_zto_does_not_generate_express(db):
    order, item, target = subscription(db, start=date.today(), end=date.today() + timedelta(days=60))
    target.shipping_channel = ShippingChannel.zto_outsource
    schedules(db)
    result = preview_order_shipping_sync(db, order.id, 9101)
    assert result.summary.to_create == 0
    assert result.items[0].reason == "非中通外包目标"


@pytest.mark.parametrize("scope,number,expected", [("full_period", None, 9101), ("from_issue", 9102, 9102)])
@pytest.mark.parametrize("explicit_start", [False, True])
def test_link_and_delivery_are_one_atomic_arrangement(db, scope, number, expected, explicit_start):
    from app.services.order_source_arrangement_service import preview_links, save_links
    source = fee_source(db)
    order, item, target = subscription(db, start=date.today() + timedelta(days=1), end=date.today() + timedelta(days=60))
    schedules(db)
    if explicit_start:
        target.effective_from_issue = 9101
        db.commit()
    row = next(row for row in candidates(db, source.id)["rows"] if row["order_id"] == order.id)
    body = link_request(source, [row]).model_dump()
    body["allocations"][0]["delivery"] = {"scope": scope, "effective_from_issue": number, "postal_confirmed": True}
    request = SourceLinkIn.model_validate(body)
    review = preview_links(db, source.id, request)
    assert db.query(OrderSourceLink).count() == db.query(OrderSourceDeliveryChange).count() == 0
    request = request.model_copy(update={"allocations": review["allocations"]})
    save_links(db, source.id, request, None)
    db.commit()
    change = db.query(OrderSourceDeliveryChange).one()
    assert change.effective_from_issue == expected
    assert item.delivery_method.value == "post_office"
    assert item.total_quantity == 1 and order.paid_amount == 240
    assert preview_order_shipping_sync(db, order.id, expected).summary.to_create == 1
    if scope == "from_issue":
        assert preview_order_shipping_sync(db, order.id, 9101).summary.to_create == 0
    with pytest.raises(HTTPException):
        save_links(db, source.id, request, None)
    db.rollback()
    assert db.query(OrderSourceDeliveryChange).count() == 1


@pytest.mark.parametrize("scope,number", [("full_period", None), ("from_issue", 9202)])
@pytest.mark.parametrize("stale", [False, True])
def test_import_links_and_arranges_same_batch_atomically(env, scope, number, stale):
    from app.models import Order
    from app.models.order_source import OrderSource
    client, db, _ = env
    first_month = (date.today().replace(day=28) + timedelta(days=4)).replace(day=1)
    for number_, days in [(9201, 2), (9202, 9), (9203, 16)]:
        published = first_month + timedelta(days=days)
        db.add(PublicationSchedule(year=published.year, issue_number=number_, publish_date=published, is_suspended=False))
        db.add(Issue(issue_number=number_, publish_date=published, status="draft"))
    db.commit()
    data = import_preview(client, [('SUB', POSTAL, 120, '卖家已发货'), ('FEE', FEE, 30, '卖家已发货')],
        when=date.today().isoformat() + ' 12:00:00', settings={'post_office_start_month': first_month.strftime('%Y-%m')})
    url = f"/api/order-import/sessions/{data['session_id']}"
    candidate = next(row for row in client.get(url + '/fee-candidates', params={'external_order_no': 'FEE'}).json()['rows'] if row.get('draft_key'))
    assert candidate['delivery_options']['full_period_issue'] == 9201
    body = {'external_order_no': 'FEE', 'expected_version': data['version'], 'reason': '合成投递范围',
        'allocations': [{'draft_key': candidate['draft_key'], 'expected_target_version': candidate['expected_target_version'],
            'amount': '30', 'delivery': {'scope': scope, 'effective_from_issue': number, 'postal_confirmed': True}}]}
    review = client.post(url + '/fee-links/preview', json=body)
    assert review.status_code == 200, review.text
    assert db.query(Order).count() == db.query(OrderSource).count() == 0
    body['allocations'] = review.json()['allocations']
    saved = client.post(url + '/fee-links', json=body)
    assert saved.status_code == 200, saved.text
    assert db.query(Order).count() == 0
    if stale:
        changed_issue = 9201 if scope == 'full_period' else 9202
        db.query(PublicationSchedule).filter_by(issue_number=changed_issue).one().publish_date += timedelta(days=1)
        db.query(Issue).filter_by(issue_number=changed_issue).one().publish_date += timedelta(days=1)
        db.commit()
    result = import_commit(client, saved.json())
    if stale:
        assert result.status_code == 409, result.text
        assert db.query(Order).count() == db.query(OrderSource).count() == db.query(OrderSourceDeliveryChange).count() == 0
        return
    assert result.status_code == 200, result.text
    order = db.query(Order).one()
    change = db.query(OrderSourceDeliveryChange).one()
    assert change.effective_from_issue == (9201 if scope == 'full_period' else 9202)
    assert order.items[0].delivery_method.value == 'post_office'
    assert preview_order_shipping_sync(db, order.id, change.effective_from_issue).summary.to_create == 1
    if scope == 'from_issue':
        assert preview_order_shipping_sync(db, order.id, 9201).summary.to_create == 0


def test_combined_api_failure_rolls_back_link_and_delivery(db, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.api.order_sources import router
    from app.auth import get_current_user
    from app.database import get_db
    from app.models import User, UserRole
    from app.services import order_source_delivery_service as delivery
    source = fee_source(db)
    order, item, target = subscription(db, start=date.today() + timedelta(days=1), end=date.today() + timedelta(days=60))
    schedules(db)
    body = link_request(source, candidates(db, source.id)['rows']).model_dump(mode='json')
    body['allocations'][0]['delivery'] = {'scope': 'full_period', 'postal_confirmed': True}
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: User(id=1, username='synthetic', role=UserRole.admin)
    client = TestClient(app, raise_server_exceptions=False)
    review = client.post(f'/api/order-sources/{source.id}/link-preview', json=body)
    assert review.status_code == 200, review.text
    body['allocations'] = review.json()['allocations']
    original = delivery.apply

    def fail_after_apply(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError('synthetic failure after delivery')

    monkeypatch.setattr(delivery, 'apply', fail_after_apply)
    response = client.put(f'/api/order-sources/{source.id}/links', json=body)
    assert response.status_code == 500
    assert db.query(OrderSourceLink).count() == db.query(OrderSourceDeliveryChange).count() == 0
    assert db.get(type(target), target.id).replaced_by_target_id is None


def test_full_period_future_postal_is_archived_and_undo_restores_it(db):
    from app.models.postal_delivery import PostalDelivery
    from app.schemas.order_source import SourceDeliveryUndoIn
    from app.services import order_source_delivery_service as delivery
    from app.services.order_source_arrangement_service import preview_links, save_links
    source = fee_source(db)
    order, item, target = subscription(db, start=date.today() + timedelta(days=1), end=date.today() + timedelta(days=60))
    schedules(db)
    postal = PostalDelivery(year=date.today().year, delivery_no='SYNTHETIC-FUTURE', order_id=order.id,
        order_item_id=item.id, fulfillment_target_id=target.id, recipient_name=target.recipient_name,
        recipient_address=target.recipient_address, copies=1, coverage_start_date=date.today() + timedelta(days=7),
        coverage_end_date=item.coverage_end_date)
    db.add(postal)
    db.commit()
    body = link_request(source, candidates(db, source.id)['rows']).model_dump()
    body['allocations'][0]['delivery'] = {'scope': 'full_period', 'postal_confirmed': True}
    request = SourceLinkIn.model_validate(body)
    request.allocations = preview_links(db, source.id, request)['allocations']
    save_links(db, source.id, request, None)
    db.commit()
    assert postal.is_archived
    assert postal.coverage_end_date == item.coverage_end_date
    change = db.query(OrderSourceDeliveryChange).one()
    undo = SourceDeliveryUndoIn(version=source.lock_version, change_id=change.id, reason='合成撤回')
    undo.expected_state = delivery.undo(db, source.id, undo, None)['expected_state']
    delivery.undo(db, source.id, undo, None, apply=True)
    db.commit()
    assert not postal.is_archived


@pytest.mark.parametrize("status,paid,pending,refund", [
    ("refunded", 141, False, None), ("pending_payment", 141, False, None),
    (None, 141, False, None), ("shipped", 0, False, None),
    ("shipped", 141, True, None), ("partial_refund", 141, False, 10),
])
def test_financial_only_fee_can_still_be_associated(db, status, paid, pending, refund):
    from app.services.order_source_arrangement_service import save_links
    source = fee_source(db)
    source.commercial_status, source.paid_amount = status, paid
    source.finance_review_required, source.verified_refund_amount = pending, refund
    subscription(db, start=date.today() + timedelta(days=1), end=date.today() + timedelta(days=60))
    schedules(db)
    rows = candidates(db, source.id)["rows"]
    assert rows and rows[0]["delivery_options"] is None
    save_links(db, source.id, link_request(source, rows), None)
    db.commit()
    assert db.query(OrderSourceLink).count() == 1
    assert db.query(OrderSourceDeliveryChange).count() == 0


def test_stale_combined_arrangement_does_not_save_links(db):
    from app.services.order_source_arrangement_service import preview_links, save_links
    source = fee_source(db)
    subscription(db, start=date.today() + timedelta(days=1), end=date.today() + timedelta(days=60))
    schedules(db)
    request = link_request(source, candidates(db, source.id)["rows"])
    from app.schemas.order_source import DeliveryArrangementIn
    request.allocations[0].delivery = DeliveryArrangementIn(scope="from_issue", effective_from_issue=9102, postal_confirmed=True)
    request.allocations = preview_links(db, source.id, request)["allocations"]
    db.query(PublicationSchedule).filter_by(issue_number=9102).one().publish_date += timedelta(days=1)
    db.query(Issue).filter_by(issue_number=9102).one().publish_date += timedelta(days=1)
    db.commit()
    with pytest.raises(HTTPException) as error:
        save_links(db, source.id, request, None)
    assert error.value.status_code == 409
    db.rollback()
    assert db.query(OrderSourceLink).count() == db.query(OrderSourceDeliveryChange).count() == 0


def test_closed_latest_allocation_still_allows_financial_only_link(db):
    from app.models import FulfillmentAllocation
    from app.services.order_source_arrangement_service import save_links
    source = fee_source(db)
    subscription(db, start=date.today() + timedelta(days=1), end=date.today() + timedelta(days=60))
    schedules(db)
    db.query(FulfillmentAllocation).one().effective_until_issue = 9101
    db.commit()
    rows = candidates(db, source.id)["rows"]
    assert rows[0]["delivery_options"] is None
    save_links(db, source.id, link_request(source, rows), None)
    db.commit()
    assert db.query(OrderSourceLink).count() == 1
    assert db.query(OrderSourceDeliveryChange).count() == 0


def test_predecessor_uses_official_issue_across_number_gap(db):
    from app.services.order_source_arrangement_service import preview_links, save_links
    from app.schemas.order_source import DeliveryArrangementIn
    source = fee_source(db)
    first = date(date.today().year + 1, 12, 24)
    _, item, target = subscription(db, start=first, end=first + timedelta(days=30))
    for number, days, suspended in [(9198, 0, False), (9199, 7, True), (9301, 14, False)]:
        published = first + timedelta(days=days)
        db.add(PublicationSchedule(year=published.year, issue_number=number, publish_date=published, is_suspended=suspended))
    db.commit()
    request = link_request(source, candidates(db, source.id)["rows"])
    request.allocations[0].delivery = DeliveryArrangementIn(scope="from_issue", effective_from_issue=9301, postal_confirmed=True)
    request.allocations = preview_links(db, source.id, request)["allocations"]
    save_links(db, source.id, request, None)
    db.commit()
    assert target.effective_until_issue == 9198
    assert item.coverage_end_date == first + timedelta(days=30)


def test_import_native_zto_rejects_redundant_conversion_cleanly(env):
    from test_order_import_review_workflow import NATIVE
    client, db, _ = env
    start = (date.today().replace(day=28) + timedelta(days=4)).replace(day=1)
    db.add(PublicationSchedule(year=start.year, issue_number=9501, publish_date=start, is_suspended=False))
    db.commit()
    data = import_preview(client, [('SUB', NATIVE, 195, '卖家已发货'), ('FEE', FEE, 30, '卖家已发货')],
        settings={'zto_start_month': start.strftime('%Y-%m')})
    url = f"/api/order-import/sessions/{data['session_id']}"
    candidate = next(row for row in client.get(url + '/fee-candidates', params={'external_order_no': 'FEE'}).json()['rows'] if row.get('draft_key'))
    response = client.post(url + '/fee-links/preview', json={'external_order_no': 'FEE', 'expected_version': data['version'],
        'reason': '合成重复转换', 'allocations': [{'draft_key': candidate['draft_key'],
            'expected_target_version': candidate['expected_target_version'], 'amount': '30',
            'delivery': {'scope': 'full_period', 'postal_confirmed': True}}]})
    assert response.status_code == 409, response.text
    assert '无需重复转换' in response.json()['detail']
