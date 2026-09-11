"""导入核对与运费归属：合成 Excel / SQLite，禁止连接业务库。"""
import io
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.order_import import router
from app.api.order_coverage import router as coverage_router
from app.auth import get_current_user
from app.database import Base, get_db
from app.models import Order, OrderEvent, User
from app.models.order_source import OrderSource, OrderSourceLink, OrderSourceVersion
from app.models.user import UserRole
from app.seeds.products import seed_products

NATIVE = '《中国经营报》半年订阅（中通 周送）X1,单价:195'
POSTAL = '《中国经营报》半年订阅（邮局周投）X1,单价:120'
FEE = '《中国经营报》运费补拍（邮局转中通）X1,单价:30'
BUNDLE = '《中国经营报》和《商学院》全年订阅（8折优惠）X1,单价:200'


@pytest.fixture
def env():
    engine = create_engine('sqlite://', poolclass=StaticPool, connect_args={'check_same_thread': False})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        seed_products(db)
        user = User(id=1, username='synthetic-import-admin', password_hash='unused', role=UserRole.admin)
        db.add(user)
        db.commit()
        app = FastAPI()
        app.include_router(router)
        app.include_router(coverage_router)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user] = lambda: user
        yield TestClient(app, raise_server_exceptions=False), db, user
    engine.dispose()


def preview(client, rows, *, when='2026-01-26 12:00:00', settings=None):
    wb = Workbook()
    ws = wb.active
    ws.append(['订单号', '产品名称', '付款金额', '地址', '订单状态', '下单时间', '支付时间'])
    for number, product, paid, status in rows:
        ws.append([number, product, paid, '合成订户,,合成测试路', status, when, when])
    output = io.BytesIO()
    wb.save(output)
    response = client.post('/api/order-import/preview', files={'file': ('synthetic.xlsx', output.getvalue())},
                           data=settings if settings is not None else {'post_office_start_month': '2026-02', 'zto_start_month': '2026-03'})
    assert response.status_code == 200, response.text
    return response.json()


def review(client, data, number, kind, **values):
    return client.post(f"/api/order-import/sessions/{data['session_id']}/review", json={
        'external_order_no': number, 'expected_version': data['version'], 'kind': kind,
        'reason': '合成核对依据', **values,
    })


def commit(client, data, **extra):
    return client.post('/api/order-import/commit', json={'session_id': data['session_id'], 'expected_version': data.get('version'), **extra})


def test_native_zto_has_no_review_and_fee_transfer_must_be_confirmed(env):
    client, db, _ = env
    data = preview(client, [('NATIVE', NATIVE, 195, '卖家已发货'), ('TRANSFER', POSTAL + '\n' + FEE, 150, '卖家已发货')])
    assert not data['rows'][0]['delivery_overridden_to_zto']
    assert data['rows'][0]['reviews'] == []
    assert data['rows'][1]['reviews'][0]['kind'] == 'delivery'
    assert commit(client, data).status_code == 409
    assert db.query(Order).count() == db.query(OrderSource).count() == 0
    changed = review(client, data, 'TRANSFER', 'delivery', item_index=0, value='zto_mf')
    assert changed.status_code == 200, changed.text
    data = changed.json()
    assert data['rows'][1]['items'][0]['coverage_start_date'] == '2026-03-01'
    assert commit(client, data).status_code == 200
    assert db.query(OrderEvent).filter(OrderEvent.payload_json['operation'].as_string() == 'import_review').count() == 1


def test_zto_product_does_not_change_other_postal_item(env):
    client, _, _ = env
    data = preview(client, [('MIXED', NATIVE + '\n' + POSTAL, 315, '卖家已发货')])
    assert [item['delivery_method'] for item in data['rows'][0]['items']] == ['zto_mf', 'post_office']
    assert data['rows'][0]['reviews'] == []


def test_unknown_status_requires_choice_and_preserves_raw_source(env):
    client, db, _ = env
    data = preview(client, [('UNKNOWN', POSTAL, 120, '合成未知状态')])
    assert data['rows'][0]['commercial_status'] is None
    assert commit(client, data).status_code == 409
    response = review(client, data, 'UNKNOWN', 'status', value='refunded')
    assert response.status_code == 200, response.text
    assert commit(client, response.json()).status_code == 200
    assert db.query(Order).one().commercial_status.value == 'refunded'
    assert db.query(OrderSourceVersion).one().snapshot['status_raw'] == '合成未知状态'


def test_unknown_status_can_be_excluded_without_creating_order(env):
    client, db, _ = env
    data = preview(client, [('UNKNOWN', POSTAL, 120, '合成未知状态'), ('NORMAL', NATIVE, 195, '卖家已发货')])
    response = review(client, data, 'UNKNOWN', 'status', value='pending_payment')
    assert response.status_code == 200, response.text
    assert response.json()['rows'][0]['decision'] == 'skip_status'
    assert commit(client, response.json()).status_code == 200
    assert db.query(Order).count() == 1
    assert db.query(Order).one().external_order_no == 'NORMAL'


def test_negative_split_cannot_be_acknowledged_and_actual_paid_is_preserved(env):
    client, db, _ = env
    data = preview(client, [('BUNDLE', BUNDLE, 200, '卖家已发货')])
    assert commit(client, data).status_code == 409
    assert review(client, data, 'BUNDLE', 'amount', amounts=['240', '-40']).status_code == 422
    assert review(client, data, 'BUNDLE', 'amount', amounts=['120', '100']).status_code == 422
    response = review(client, data, 'BUNDLE', 'amount', amounts=['120', '80'])
    assert response.status_code == 200, response.text
    assert commit(client, response.json()).status_code == 200
    order = db.query(Order).one()
    assert order.paid_amount == Decimal('200')
    assert sorted(item.subtotal for item in order.items) == [Decimal('80'), Decimal('120')]


def test_stale_review_and_missing_review_version_rejected(env):
    client, db, _ = env
    data = preview(client, [('TRANSFER', POSTAL + '\n' + FEE, 150, '卖家已发货')])
    response = review(client, data, 'TRANSFER', 'delivery', item_index=0, value='post_office')
    assert response.status_code == 200, response.text
    assert review(client, data, 'TRANSFER', 'delivery', item_index=0, value='zto_mf').status_code == 409
    assert commit(client, data).status_code == 409
    assert client.post('/api/order-import/commit', json={'session_id': data['session_id']}).status_code == 409
    assert db.query(Order).count() == 0


def test_fee_can_link_to_same_batch_without_writing_until_commit(env):
    client, db, _ = env
    data = preview(client, [('SUB', POSTAL, 120, '卖家已发货'), ('FEE', FEE, 30, '卖家已发货')])
    url = f"/api/order-import/sessions/{data['session_id']}"
    candidates = client.get(url + '/fee-candidates', params={'external_order_no': 'FEE'}).json()['rows']
    candidate = next(row for row in candidates if row.get('draft_key') == 'SUB#0')
    response = client.post(url + '/fee-links', json={
        'external_order_no': 'FEE', 'expected_version': data['version'], 'reason': '合成费用归属',
        'allocations': [{'draft_key': candidate['draft_key'], 'expected_target_version': candidate['expected_target_version'], 'amount': '30'}],
    })
    assert response.status_code == 200, response.text
    assert db.query(Order).count() == db.query(OrderSource).count() == 0
    result = commit(client, response.json())
    assert result.status_code == 200, result.text
    fee = db.query(OrderSource).filter_by(kind='shipping_fee').one()
    link = db.query(OrderSourceLink).filter_by(source_id=fee.id, active=1).one()
    assert link.order_item_id is not None and link.target_id is not None
    assert link.delivery_from_issue is None
    assert db.query(Order).one().items[0].delivery_method.value == 'post_office'
    assert result.json()['fee_sources'][0]['linked'] is True


def fee_candidates(client, data):
    response = client.get(f"/api/order-import/sessions/{data['session_id']}/fee-candidates", params={'external_order_no': 'FEE'})
    assert response.status_code == 200, response.text
    return response.json()['rows']


def save_fee(client, data, candidate, amount='30', **extra):
    allocation = {k: candidate[k] for k in ('draft_key', 'order_id', 'order_item_id', 'target_id', 'expected_target_version')
                  if candidate.get(k) is not None}
    return client.post(f"/api/order-import/sessions/{data['session_id']}/fee-links", json={
        'external_order_no': 'FEE', 'expected_version': data['version'], 'reason': '合成费用归属',
        'allocations': [{**allocation, 'amount': amount, **extra}],
    })


def test_existing_fee_target_invalid_amount_identity_and_stale_target(env):
    client, db, _ = env
    assert commit(client, preview(client, [('EXISTING', POSTAL, 120, '卖家已发货')])).status_code == 200
    data = preview(client, [('FEE', FEE, 30, '卖家已发货')])
    candidate = fee_candidates(client, data)[0]
    assert candidate['order_id'] == db.query(Order).one().id
    assert save_fee(client, data, candidate, amount='29').status_code == 422
    assert save_fee(client, data, candidate, order_id=99999).status_code == 422
    assert save_fee(client, data, candidate, draft_key='FAKE#0').status_code == 422
    saved = save_fee(client, data, candidate)
    assert saved.status_code == 200, saved.text
    from app.models import FulfillmentTarget
    target = db.query(FulfillmentTarget).one()
    target.recipient_address = '合成变更地址'
    db.commit()
    assert commit(client, saved.json()).status_code == 409
    assert db.query(OrderSource).filter_by(kind='shipping_fee').count() == 0
    updated = save_fee(client, saved.json(), fee_candidates(client, saved.json())[0])
    assert updated.status_code == 200, updated.text
    assert commit(client, updated.json()).status_code == 200
    assert db.query(Order).count() == 1


def test_same_batch_target_change_requires_reselect(env):
    client, db, _ = env
    data = preview(client, [('SUB', POSTAL, 120, '卖家已发货'), ('FEE', FEE, 30, '卖家已发货')])
    saved = save_fee(client, data, fee_candidates(client, data)[0]).json()
    edited = review(client, saved, 'SUB', 'delivery', item_index=0, value='zto_mf').json()
    result = commit(client, edited)
    assert result.status_code == 409, result.text
    assert '本批关联订阅已变化' in result.text
    assert db.query(Order).count() == db.query(OrderSource).count() == 0
    reselected = save_fee(client, edited, fee_candidates(client, edited)[0])
    assert reselected.status_code == 200, reselected.text
    assert commit(client, reselected.json()).status_code == 200


def test_link_failure_rolls_back_entire_import_and_preserves_draft(env, monkeypatch):
    from app.services import order_import_fee_service as service
    client, db, _ = env
    data = preview(client, [('SUB', POSTAL, 120, '卖家已发货'), ('FEE', FEE, 30, '卖家已发货')])
    saved = save_fee(client, data, fee_candidates(client, data)[0]).json()
    original = service.link_source

    def fail_after_link(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError('synthetic failure after link and audit')

    monkeypatch.setattr(service, 'link_source', fail_after_link)
    assert commit(client, saved).status_code == 500
    assert db.query(Order).count() == db.query(OrderSource).count() == db.query(OrderEvent).count() == 0
    assert client.get(f"/api/order-import/sessions/{data['session_id']}").status_code == 200
    monkeypatch.setattr(service, 'link_source', original)
    db.expunge_all()  # 模拟失败请求结束后，新请求使用新的 identity map。
    assert commit(client, saved).status_code == 200


def test_unmatched_fee_can_be_retained_for_follow_up(env):
    client, db, _ = env
    data = preview(client, [('FEE', FEE, 30, '卖家已发货')])
    assert fee_candidates(client, data) == []
    result = commit(client, data)
    assert result.status_code == 200, result.text
    assert result.json()['fee_sources'][0]['linked'] is False
    assert db.query(Order).count() == 0


def test_missing_date_and_product_can_be_repaired_without_changing_source(env):
    from app.models import Product
    client, db, _ = env
    data = preview(client, [('REPAIR', '合成未识别商品X1,单价:120', 120, '卖家已发货')], when=None)
    assert data['rows'][0]['decision'] == 'unresolved'
    fixed = review(client, data, 'REPAIR', 'date', value='2026-01-25')
    assert fixed.status_code == 200, fixed.text
    assert fixed.json()['rows'][0]['order_date'] == '2026-01-25'
    product = db.query(Product).filter(Product.delivery_method == 'post_office', Product.is_bundle.is_(False)).first()
    fixed = review(client, fixed.json(), 'REPAIR', 'product', item_index=0, product_id=product.id)
    assert fixed.status_code == 200, fixed.text
    assert fixed.json()['rows'][0]['decision'] == 'import'
    assert commit(client, fixed.json()).status_code == 200
    source = db.query(OrderSourceVersion).one().snapshot
    assert source['order_date'] is None
    assert source['product_lines'][0]['name'] == '合成未识别商品'
    assert db.query(Order).one().order_date.isoformat() == '2026-01-25'
    assert db.query(OrderEvent).filter(OrderEvent.payload_json['operation'].as_string() == 'import_review').count() == 2
    date_audit = db.query(OrderEvent).filter(OrderEvent.payload_json['kind'].as_string() == 'date').one().payload_json
    assert date_audit['before']['order_date'] is None
    assert date_audit['after']['order_date'] == '2026-01-25'


def test_review_permissions_owner_and_expired_session(env, monkeypatch):
    from app import order_import_cache
    client, _, user = env
    data = preview(client, [('SUB', POSTAL, 120, '卖家已发货')])
    user.role = UserRole.operator
    assert review(client, data, 'SUB', 'status', value='paid').status_code == 403
    user.role = UserRole.admin
    client.app.dependency_overrides[get_current_user] = lambda: User(id=999, username='synthetic-other', role=UserRole.admin)
    assert client.get(f"/api/order-import/sessions/{data['session_id']}").status_code == 403
    assert review(client, data, 'SUB', 'status', value='paid').status_code == 403
    client.app.dependency_overrides[get_current_user] = lambda: user
    monkeypatch.setattr(order_import_cache, '_TTL_SECONDS', 0)
    assert review(client, data, 'SUB', 'status', value='paid').status_code == 400


def test_product_config_change_blocks_stale_draft(env):
    from app.models import Product
    client, db, _ = env
    data = preview(client, [('SUB', POSTAL, 120, '卖家已发货')])
    from app.services.product_resolver_service import match_product
    product = match_product(db.query(Product).all(), POSTAL.split('X1')[0])
    assert product is not None
    product.active = False
    db.commit()
    assert commit(client, data).status_code == 409
    assert db.query(Order).count() == 0


def test_legacy_unknown_status_does_not_create_false_source_revision(env):
    import hashlib
    import json
    client, db, _ = env
    data = preview(client, [('FEE', FEE, 30, '合成旧未知状态')])
    assert commit(client, data).status_code == 200
    version = db.query(OrderSourceVersion).one()
    version.snapshot = {**version.snapshot, 'commercial_status': 'paid'}
    old_content = {k: v for k, v in version.snapshot.items() if k not in {'filename', 'source_sheet', 'source_row'}}
    version.fingerprint = hashlib.sha256(json.dumps(old_content, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    db.commit()
    again = preview(client, [('FEE', FEE, 30, '合成旧未知状态')])
    assert again['rows'][0]['decision'] == 'duplicate'
    assert commit(client, again).status_code == 200
    assert db.query(OrderSourceVersion).count() == 1


def test_manual_coverage_survives_delivery_edit_and_requires_reconfirmation(env):
    client, db, _ = env
    data = preview(client, [('SUB', POSTAL, 120, '卖家已发货')], settings={'mode': 'historical'})
    sid = data['session_id']
    candidate = client.get('/api/order-coverage/candidates', params={'import_session_id': sid}).json()['rows'][0]
    plan = client.post('/api/order-coverage/preview', json={'import_session_id': sid, 'reason': '合成原订期', 'changes': [{
        'key': candidate['key'], 'expected_version': candidate['version'],
        'coverage_start_date': '2026-02-01', 'coverage_end_date': '2026-07-31',
    }]})
    assert plan.status_code == 200, plan.text
    applied = client.post('/api/order-coverage/apply', json={'preview_id': plan.json()['preview_id']})
    assert applied.status_code == 200, applied.text
    assert applied.json()['import_version'] == 2
    data = client.get(f'/api/order-import/sessions/{sid}').json()
    edited = review(client, data, 'SUB', 'delivery', item_index=0, value='zto_mf')
    assert edited.status_code == 200, edited.text
    assert edited.json()['rows'][0]['items'][0]['coverage_start_date'] == '2026-02-01'
    assert commit(client, edited.json()).status_code == 409
    confirmed = review(client, edited.json(), 'SUB', 'coverage', item_index=0)
    assert confirmed.status_code == 200, confirmed.text
    assert commit(client, confirmed.json()).status_code == 200
    assert db.query(Order).one().items[0].coverage_end_date.isoformat() == '2026-07-31'
    assert db.query(Order).one().items[0].term_start_month == '2026-02'


def test_existing_and_batch_matches_are_not_both_reported_as_unique(env):
    from app.models import FulfillmentTarget
    from app.order_import_cache import get_order_import_session
    client, db, _ = env
    assert commit(client, preview(client, [('EXISTING', POSTAL, 120, '卖家已发货')])).status_code == 200
    target = db.query(FulfillmentTarget).one()
    target.recipient_phone = '00000000000'
    db.commit()
    data = preview(client, [('SUB', POSTAL, 120, '卖家已发货'), ('FEE', FEE, 30, '卖家已发货')], when='2026-03-15')
    payload = get_order_import_session(data['session_id'])
    payload['rows'][0]['order_create']['items'][0]['targets'][0]['recipient_phone'] = '00000000000'
    next(r for r in payload['sources'] if r['kind'] == 'shipping_fee')['snapshot']['recipient_phone'] = '00000000000'
    candidates = fee_candidates(client, data)
    assert len(candidates) == 2
    assert all(candidate['confidence'] == 'possible' for candidate in candidates)


def test_status_skip_then_restore_keeps_review_audit(env):
    client, db, _ = env
    data = preview(client, [('SUB', POSTAL, 120, '合成未知状态')])
    skipped = review(client, data, 'SUB', 'status', value='pending_payment').json()
    restored = review(client, skipped, 'SUB', 'status', value='paid')
    assert restored.status_code == 200, restored.text
    assert commit(client, restored.json()).status_code == 200
    assert db.query(OrderEvent).filter(OrderEvent.payload_json['operation'].as_string() == 'import_review').count() == 2
