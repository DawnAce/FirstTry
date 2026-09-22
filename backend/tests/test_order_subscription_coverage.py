"""刊期起订的 API 往返与发货边界；全部使用合成数据和内存数据库。"""
from datetime import date

import pytest
from sqlalchemy.orm import Session

from test_orders_api import client, _make_create_payload
from app.models import PublicationSchedule


def seed_schedule(client):
    with Session(client.db_engine) as db:
        db.add_all([
            PublicationSchedule(year=2026, issue_number=None, publish_date=date(2026, 12, 28), is_suspended=True),
            PublicationSchedule(year=2026, issue_number=2654, publish_date=date(2026, 6, 1), is_suspended=False),
            PublicationSchedule(year=2026, issue_number=2655, publish_date=date(2026, 6, 8), is_suspended=False),
            PublicationSchedule(year=2026, issue_number=2656, publish_date=date(2026, 6, 15), is_suspended=True),
            PublicationSchedule(year=2027, issue_number=2703, publish_date=date(2027, 5, 31), is_suspended=False),
            PublicationSchedule(year=2027, issue_number=2704, publish_date=date(2027, 6, 7), is_suspended=False),
        ])
        db.commit()


def payload():
    data = _make_create_payload(targets_count=1, total_quantity=1,
                                coverage_start="2026-06-08", coverage_end="2027-06-07")
    data['total_amount'] = '199'
    data['items'][0].update(subscription_term='one_year', delivery_method='zto_mf',
                            coverage_start_mode='issue', coverage_start_issue=2655,
                            unit_price='199', subtotal='199')
    return data


def test_issue_start_round_trip_preserves_annual_term_and_trade_price(client):
    seed_schedule(client)
    response = client.post('/api/orders', json=payload())
    assert response.status_code == 201, response.text
    item = response.json()['items'][0]
    assert item['coverage_start_mode'] == 'issue'
    assert item['coverage_start_issue'] == 2655
    assert item['coverage_start_date'] == '2026-06-08'
    assert item['coverage_end_date'] == '2027-06-07'
    assert item['subscription_term'] == 'one_year'
    assert float(item['unit_price']) == 199
    saved = client.get(f"/api/orders/{response.json()['id']}").json()['items'][0]
    assert saved == item


@pytest.mark.parametrize(('issue', 'start', 'status'), [
    (9999, '2026-06-08', 422), (2656, '2026-06-15', 422), (2655, '2026-06-01', 409),
])
def test_issue_save_revalidates_official_schedule(client, issue, start, status):
    seed_schedule(client)
    data = payload()
    data['items'][0].update(coverage_start_issue=issue, coverage_start_date=start)
    response = client.post('/api/orders', json=data)
    assert response.status_code == status, response.text
    assert client.get('/api/orders').json()['total'] == 0


def test_preview_excludes_previous_and_suspended_issues_without_shortening_dates(client):
    seed_schedule(client)
    response = client.post('/api/orders/coverage-preview', json={
        'coverage_start_date': '2026-06-08', 'coverage_end_date': '2027-06-07',
    })
    assert response.status_code == 200, response.text
    preview = response.json()
    assert preview['first_issue']['issue_number'] == 2655
    assert preview['last_issue']['issue_number'] == 2704
    assert preview['expected_issue_count'] == 4  # includes the fixture's June 29 issue
    assert not preview['schedule_incomplete']
    response = client.post('/api/orders/coverage-preview', json={
        'coverage_start_date': '2027-06-08', 'coverage_end_date': '2028-06-07',
    })
    assert response.json()['schedule_incomplete']
    assert response.json()['expected_issue_count'] == 0


def test_draft_and_active_edits_keep_explicit_end_date_and_audit(client):
    seed_schedule(client)
    created = client.post('/api/orders', json=payload()).json()
    item_data = payload()['items'][0] | {'id': created['items'][0]['id'], 'coverage_end_date': '2027-05-31'}
    response = client.put(f"/api/orders/{created['id']}/items", json={'items': [item_data]})
    assert response.status_code == 200, response.text
    assert response.json()['items'][0]['coverage_end_date'] == '2027-05-31'
    assert client.post(f"/api/orders/{created['id']}/confirm").status_code == 200
    item_data['coverage_end_date'] = '2027-06-07'
    response = client.put(f"/api/orders/{created['id']}/items", json={
        'effective_from_issue': 2655, 'change_reason': '合成测试：按实际起投日订阅一年', 'items': [item_data],
    })
    assert response.status_code == 200, response.text
    assert response.json()['items'][0]['coverage_end_date'] == '2027-06-07'
    assert float(response.json()['items'][0]['unit_price']) == 199
    events = client.get(f"/api/orders/{created['id']}/events").json()
    assert any(e['event_type'] == 'item_modified' for e in events)


def test_issue_selection_does_not_apply_to_other_publications(client):
    seed_schedule(client)
    data = payload()
    data['items'][0]['publication'] = 'business_school'
    assert client.post('/api/orders', json=data).status_code == 422


def test_base_fields_and_dates_rollback_together_on_stale_issue(client):
    seed_schedule(client)
    created = client.post('/api/orders', json=payload()).json()
    item = payload()['items'][0] | {'id': created['items'][0]['id'], 'coverage_start_date': '2026-06-01'}
    response = client.put(f"/api/orders/{created['id']}", json={
        'notes': '不应单独保存', 'items_update': {'items': [item]},
    })
    assert response.status_code == 409, response.text
    fresh = client.get(f"/api/orders/{created['id']}").json()
    assert fresh['notes'] is None
    assert fresh['items'][0]['coverage_start_date'] == '2026-06-08'


def test_draft_recipients_can_be_saved_and_confirmed(client):
    seed_schedule(client)
    created = client.post('/api/orders', json=payload()).json()
    item = payload()['items'][0] | {'id': created['items'][0]['id']}
    item['targets'][0]['recipient_name'] = '合成新收件人'
    response = client.put(f"/api/orders/{created['id']}", json={'items_update': {'items': [item]}})
    assert response.status_code == 200, response.text
    assert len(response.json()['items'][0]['allocations']) == 1
    assert response.json()['items'][0]['allocations'][0]['targets'][0]['recipient_name'] == '合成新收件人'
    assert client.post(f"/api/orders/{created['id']}/confirm").status_code == 200


def test_active_edit_requires_effective_issue_and_rejects_reversed_dates(client):
    seed_schedule(client)
    created = client.post('/api/orders', json=payload()).json()
    client.post(f"/api/orders/{created['id']}/confirm")
    item = payload()['items'][0] | {'id': created['items'][0]['id']}
    assert client.put(f"/api/orders/{created['id']}/items", json={'items': [item]}).status_code == 422
    item['coverage_end_date'] = '2026-06-07'
    assert client.put(f"/api/orders/{created['id']}/items", json={'effective_from_issue': 2655, 'items': [item]}).status_code == 422


def test_confirm_rechecks_start_issue_after_draft_saved(client):
    seed_schedule(client)
    created = client.post('/api/orders', json=payload()).json()
    with Session(client.db_engine) as db:
        db.query(PublicationSchedule).filter_by(issue_number=2655).one().publish_date = date(2026, 6, 9)
        db.commit()
    response = client.post(f"/api/orders/{created['id']}/confirm")
    assert response.status_code == 409, response.text
    assert client.get(f"/api/orders/{created['id']}").json()['status'] == 'draft'
