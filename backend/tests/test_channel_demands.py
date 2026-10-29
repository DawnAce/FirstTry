"""机构需求使用合成数据验证录入、人工核对、印数采用与历史保护。"""
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import get_current_user
from app.database import Base, get_db
from app.main import app
from app.models import Issue, IssueStatus, Partner, PublicationSchedule, ReportEntry, ReportItemTemplate
from app.models.channel_demand import ChannelDemandAdoption, ChannelDemandProfile
from app.models.user import User, UserRole


@pytest.fixture
def env():
    engine = create_engine('sqlite://', poolclass=StaticPool, connect_args={'check_same_thread': False})
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False)()
    user = User(username='synthetic-demand', password_hash='unused', role=UserRole.admin)
    partner = Partner(name='测试机构正式主体')
    db.add_all([user, partner])
    db.flush()
    db.add(ChannelDemandProfile(partner_id=partner.id, display_name='测试机构', category='chengdu', pricing_policy='chengdu_annual'))
    db.add(ReportItemTemplate(category='chengdu', sub_category='成都杂志铺', display_name='成都杂志铺'))
    for i in range(49):
        db.add(PublicationSchedule(year=2025, issue_number=2501+i, publish_date=date(2025, 1, 6)+timedelta(weeks=i)))
    # 正式确认记录说明全年49期，最后几周可休刊。
    from app.models import PublicationScheduleUpload
    db.add(PublicationScheduleUpload(year=2025, original_filename='synthetic.pdf', stored_path='unused', status='committed', summary_json={'published_count': 49}))
    issue = Issue(issue_number=2501, publish_date=date(2025, 1, 6))
    db.add(issue)
    db.flush()
    db.add(ReportEntry(issue_id=issue.id, category='chengdu', sub_category='成都杂志铺', value=17))
    db.commit()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        yield TestClient(app), db, partner, issue, user
    finally:
        app.dependency_overrides.clear()
        db.close()
        engine.dispose()


def body(partner, **overrides):
    result = dict(partner_id=partner.id, category='chengdu', received_date='2024-12-16',
                document_type='order', cycle='month', transport='zto', pricing_mode='chengdu_annual',
                lines=[dict(issue_number=2501, sub_category='成都杂志铺', quantity=100, review_status='confirmed')])
    result.update(overrides)
    return result


def create(client, partner, **overrides):
    r = client.post('/api/channel-demands', json=body(partner, **overrides))
    assert r.status_code == 201, r.text
    return r.json()


def confirm(client, doc, reviewed=True):
    return client.post(f"/api/channel-demands/{doc['id']}/confirm", json={'version': doc['version'], 'reviewed': reviewed})


def test_record_confirm_adopt_and_trace(env):
    client, db, partner, issue, _ = env
    doc = create(client, partner)
    assert doc['lines'][0]['unit_price'] == '2.35'
    assert doc['estimated_amount'] == '235.00'
    assert confirm(client, doc, False).status_code == 422
    assert confirm(client, doc).status_code == 200
    preview = client.get(f'/api/channel-demands/print/{issue.id}').json()
    assert preview['rows'][0]['current_quantity'] == 17
    assert preview['can_apply']
    endpoint = f'/api/channel-demands/print/{issue.id}/apply'
    assert client.post(endpoint, json={'token': preview['token']}).status_code == 200
    assert client.post(endpoint, json={'token': preview['token']}).status_code == 200
    again = client.get(f'/api/channel-demands/print/{issue.id}').json()
    assert client.post(endpoint, json={'token': again['token']}).status_code == 200
    assert db.query(ReportEntry).one().value == 100
    assert db.query(ChannelDemandAdoption).count() == 1
    trace = client.get(f"/api/channel-demands/{doc['id']}/trace").json()
    assert trace[0]['adopted_quantity'] == 100


def test_pending_not_zero_blocks_print_and_duplicate_conflict(env):
    client, db, partner, issue, _ = env
    doc = create(client, partner, lines=[dict(issue_number=2501, sub_category='成都杂志铺', quantity=None, review_status='pending'),
                                       dict(issue_number=2502, sub_category='成都杂志铺', quantity=0, review_status='none')])
    assert confirm(client, doc).status_code == 200
    preview = client.get(f'/api/channel-demands/print/{issue.id}').json()
    assert not preview['can_apply'] and preview['rows'][0]['errors']
    duplicate = create(client, partner)
    assert confirm(client, duplicate).status_code == 409
    result = client.post(f'/api/issues/{issue.id}/report/confirm')
    assert result.status_code == 422


def test_version_conflict_revision_and_locked_history(env):
    client, db, partner, issue, _ = env
    doc = create(client, partner)
    changed = body(partner)
    changed['version'] = 50
    assert client.put(f"/api/channel-demands/{doc['id']}", json=changed).status_code == 409
    assert confirm(client, doc).status_code == 200
    revised = client.post(f"/api/channel-demands/{doc['id']}/revise", json={'version': 1}).json()
    assert revised['supersedes_id'] == doc['id']
    assert confirm(client, revised).status_code == 200
    assert client.get(f"/api/channel-demands/{doc['id']}").json()['status'] == 'superseded'
    issue.status = IssueStatus.confirmed
    db.commit()
    later = client.post(f"/api/channel-demands/{revised['id']}/revise", json={'version': 1}).json()
    changed_locked = client.put(f"/api/channel-demands/{later['id']}", json=body(partner, lines=[dict(issue_number=2501, sub_category='成都杂志铺', quantity=999, review_status='confirmed')])).json()
    assert confirm(client, changed_locked).status_code == 409
    assert not client.get(f'/api/channel-demands/print/{issue.id}').json()['can_apply']


def test_schedule_price_identity_and_readonly(env):
    client, db, partner, issue, user = env
    partner.name = '测试改名后正式主体'
    db.commit()
    assert create(client, partner)['display_name'] == '测试机构'
    assert client.get('/api/channel-demands/pricing/2025').json()['unit_price'] == '2.35'
    assert client.get('/api/channel-demands/pricing/2026').status_code == 422
    assert client.post('/api/channel-demands', json=body(partner, lines=[dict(issue_number=9999, sub_category='成都杂志铺', quantity=0, review_status='confirmed')])).status_code == 422
    user.role = UserRole.viewer
    assert client.post('/api/channel-demands', json=body(partner)).status_code == 403
    assert client.get('/api/channel-demands').status_code == 200


def test_stale_preview_and_old_source_conflict(env):
    client, db, partner, issue, _ = env
    doc = create(client, partner)
    confirm(client, doc)
    preview = client.get(f'/api/channel-demands/print/{issue.id}').json()
    db.query(ReportEntry).one().value = 18
    db.commit()
    assert client.post(f'/api/channel-demands/print/{issue.id}/apply', json={'token': preview['token']}).status_code == 409
    from app.models import ReportSourceDocument, ReportSourceItem
    source = ReportSourceDocument(channel='chengdu', document_type='monthly', original_filename='synthetic.png', display_name='合成', stored_path='unused', sha256='a'*64, size=1, extraction_status='confirmed')
    db.add(source)
    db.flush()
    db.add(ReportSourceItem(document_id=source.id, issue_number=2501, item_kind='base', category='chengdu', sub_category='成都杂志铺', source_status='confirmed', source_action='base', effect_status='active', source_quantity=100, applied_quantity=100))
    db.commit()
    assert not client.get(f'/api/channel-demands/print/{issue.id}').json()['can_apply']


def test_attachment_review_version_duplicate_and_original_retained(env, tmp_path, monkeypatch):
    client, db, partner, issue, _ = env
    from app.services import attachment_service
    from app.api import channel_demands
    from io import BytesIO
    from PIL import Image
    monkeypatch.setattr(attachment_service, 'UPLOAD_ROOT', tmp_path / 'uploads')
    image = BytesIO()
    Image.new('RGB', (64, 32), 'white').save(image, 'PNG')
    content = image.getvalue()
    monkeypatch.setattr(channel_demands, 'recognize_report_source', lambda **kwargs: {'raw_text': '合成凭证', 'warnings': ['请人工核对'], 'suggestions': [{'source_quantity': 900}]})
    doc = create(client, partner)
    path = f"/api/channel-demands/{doc['id']}/attachments"
    result = client.post(path, data={'version': 1}, files={'file': ('synthetic.png', content, 'image/png')})
    assert result.status_code == 201, result.text
    updated = result.json()
    assert updated['version'] == 2 and updated['lines'][0]['quantity'] == 100
    assert updated['attachments'][0]['reviewed_version'] is None
    assert confirm(client, doc).status_code == 409
    assert confirm(client, updated, False).status_code == 422
    duplicate = client.post(path, data={'version': 2}, files={'file': ('synthetic.png', content, 'image/png')}).json()
    assert duplicate['version'] == 2 and len(duplicate['attachments']) == 1
    assert confirm(client, updated).status_code == 200
    reviewed = client.get(f"/api/channel-demands/{doc['id']}").json()
    assert reviewed['attachments'][0]['reviewed_version'] == 2
    aid = reviewed['attachments'][0]['id']
    assert client.get(f"{path}/{aid}/download").content == content
    revised = client.post(f"/api/channel-demands/{doc['id']}/revise", json={'version': 2}).json()
    assert revised['attachments'][0]['reviewed_version'] is None
    assert client.get(f"/api/channel-demands/{revised['id']}/attachments/{revised['attachments'][0]['id']}/download").content == content


def test_postal_parts_suspension_and_non_sales_report(env):
    client, db, _, issue, _ = env
    postal = Partner(name='测试邮发主体')
    db.add(postal)
    db.flush()
    db.add(ChannelDemandProfile(partner_id=postal.id, display_name='测试邮发', category='postal'))
    db.add_all([ReportItemTemplate(category='postal', sub_category=sub, display_name=sub) for sub in ['本市', '外埠']])
    db.add_all([ReportEntry(issue_id=issue.id, category='postal', sub_category=sub, value=1) for sub in ['本市', '外埠']])
    db.commit()
    lines = [dict(issue_number=2501, sub_category=sub, quantity=count, review_status='confirmed') for sub, count in [('本市', 120), ('外埠', 230)]]
    overrides = dict(category='postal', document_type='report', cycle='week', transport='pending', pricing_mode='unpriced')
    assert client.post('/api/channel-demands', json=body(postal, **overrides, lines=lines[:1])).status_code == 422
    doc = create(client, postal, **overrides, lines=lines)
    assert doc['pricing'] is None and all(l['unit_price'] is None for l in doc['lines'])
    assert confirm(client, doc).status_code == 200
    preview = client.get(f'/api/channel-demands/print/{issue.id}').json()
    assert sorted(r['quantity'] for r in preview['rows']) == [120, 230]
    assert client.post(f'/api/channel-demands/print/{issue.id}/apply', json={'token': preview['token']}).status_code == 200
    from app.models import Order
    assert db.query(Order).count() == 0
    schedule = db.query(PublicationSchedule).filter_by(issue_number=2502).one()
    schedule.is_suspended = True
    db.commit()
    assert client.post('/api/channel-demands', json=body(postal, lines=[dict(issue_number=2502, sub_category='本市', quantity=10, review_status='confirmed')])).status_code == 422


def test_annual_rounding_cross_year_and_partial_schedule(env):
    from decimal import Decimal
    from app.models import PublicationScheduleUpload
    client, db, partner, _, _ = env
    for i in range(50):
        db.add(PublicationSchedule(year=2024, issue_number=2401+i, publish_date=date(2024, 1, 1)+timedelta(weeks=i)))
    db.add(PublicationScheduleUpload(year=2024, original_filename='synthetic.pdf', stored_path='unused', status='committed', summary_json={'published_count': 50}))
    db.commit()
    assert client.get('/api/channel-demands/pricing/2024').json()['unit_price'] == '2.30'
    doc = create(client, partner, lines=[dict(issue_number=n, sub_category='成都杂志铺', quantity=101, review_status='confirmed') for n in [2450, 2501]])
    assert [l['unit_price'] for l in doc['lines']] == ['2.30', '2.35']
    assert sum(Decimal(l['unit_price']) * l['quantity'] for l in doc['lines']) == Decimal('469.65')
    schedule = db.query(PublicationSchedule).filter_by(issue_number=2502).one()
    schedule.publish_date += timedelta(days=1)
    db.commit()
    assert confirm(client, doc).status_code == 409
    db.query(PublicationScheduleUpload).filter_by(year=2024).delete()
    db.commit()
    assert client.get('/api/channel-demands/pricing/2024').status_code == 422


def test_print_confirmation_rejects_manual_drift_after_adoption(env):
    client, db, partner, issue, _ = env
    doc = create(client, partner)
    confirm(client, doc)
    preview = client.get(f'/api/channel-demands/print/{issue.id}').json()
    client.post(f'/api/channel-demands/print/{issue.id}/apply', json={'token': preview['token']})
    result = client.post(f'/api/issues/{issue.id}/report/confirm', json={'entries': [{'category': 'chengdu', 'sub_category': '成都杂志铺', 'value': 90}]})
    assert result.status_code == 422
    assert any('机构需求' in e['message'] for e in result.json()['detail'])


def test_old_source_cannot_reapply_after_demand_adoption(env):
    client, db, partner, issue, _ = env
    from app.services.channel_demand_service import assert_no_demand_adoption
    from fastapi import HTTPException
    doc = create(client, partner)
    confirm(client, doc)
    preview = client.get(f'/api/channel-demands/print/{issue.id}').json()
    client.post(f'/api/channel-demands/print/{issue.id}/apply', json={'token': preview['token']})
    with pytest.raises(HTTPException) as caught:
        assert_no_demand_adoption(db, issue.issue_number, 'chengdu', '成都杂志铺')
    assert caught.value.status_code == 409


def test_schema_rejects_missing_confirmed_quantity_and_non_integer(env):
    client, _, partner, _, _ = env
    for quantity in [None, -1, 1.5, True]:
        response = client.post('/api/channel-demands', json=body(partner, lines=[dict(issue_number=2501, sub_category='成都杂志铺', quantity=quantity, review_status='confirmed')]))
        assert response.status_code == 422


def test_partner_delete_preserves_demands_and_unused_profile_can_be_removed(env):
    client, db, partner, _, _ = env
    create(client, partner)
    assert client.delete(f'/api/partners/{partner.id}').status_code == 409
    unused = Partner(name='合成未使用机构')
    db.add(unused)
    db.flush()
    db.add(ChannelDemandProfile(partner_id=unused.id, display_name='合成', category='chengdu'))
    db.commit()
    assert client.delete(f'/api/partners/{unused.id}').status_code == 204
    assert db.get(ChannelDemandProfile, unused.id) is None


def test_optional_contract_identity_and_delete_protection(env):
    from app.models import Contract
    client, db, partner, _, _ = env
    contract = Contract(partner_id=partner.id, title='合成可选合同')
    db.add(contract)
    db.commit()
    create(client, partner, contract_id=contract.id)
    assert client.delete(f'/api/contracts/{contract.id}').status_code == 409
    assert client.post('/api/channel-demands', json=body(partner, transport='channel')).status_code == 422
    other = Partner(name='合成其他主体')
    db.add(other)
    db.commit()
    assert client.post('/api/channel-demands', json=body(other, contract_id=contract.id, pricing_mode='unpriced')).status_code == 422
    assert client.put(f'/api/contracts/{contract.id}', json={'partner_id': other.id}).status_code == 409


def test_monthly_revision_resolves_future_pending_without_changing_locked_issue(env):
    client, db, partner, issue, _ = env
    doc = create(client, partner, lines=[dict(issue_number=2501, sub_category='成都杂志铺', quantity=100, review_status='confirmed'),
                                       dict(issue_number=2502, sub_category='成都杂志铺', quantity=None, review_status='pending')])
    assert confirm(client, doc).status_code == 200
    preview = client.get(f'/api/channel-demands/print/{issue.id}').json()
    client.post(f'/api/channel-demands/print/{issue.id}/apply', json={'token': preview['token']})
    issue.status = IssueStatus.confirmed
    db.commit()
    revised = client.post(f"/api/channel-demands/{doc['id']}/revise", json={'version': 1}).json()
    updated = body(partner, version=revised['version'], lines=[dict(issue_number=2501, sub_category='成都杂志铺', quantity=100, review_status='confirmed'),
                                                               dict(issue_number=2502, sub_category='成都杂志铺', quantity=120, review_status='confirmed')])
    saved = client.put(f"/api/channel-demands/{revised['id']}", json=updated).json()
    result = confirm(client, saved)
    assert result.status_code == 200, result.text
    assert db.query(ReportEntry).one().value == 100
    assert db.query(ChannelDemandAdoption).one().source_snapshot[0]['demand_id'] == doc['id']
    trace = client.get(f"/api/channel-demands/{saved['id']}/trace").json()
    assert trace[0]['adopted_quantity'] == 100 and trace[0]['adopted_demand_id'] == doc['id']
