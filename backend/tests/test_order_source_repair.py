"""历史来源修复必须预览、显式选择、原子写入并保留旧关联。"""
import pytest
from fastapi import HTTPException
from app.models import Order, OrderStatus
from app.models.user import User, UserRole
from app.models.order_source import OrderSource, OrderSourceLink, OrderSourceVersion
from app.services.order_source_repair_service import preview_repair, apply_repair
from test_order_source_identity import db, order, workbook
from app.services.cbj_order_import_service import preview_import, commit_import, BatchSettings


def setup_pair(db):
    _, sid = preview_import(db, workbook(), BatchSettings(mode='historical'))
    commit_import(db, sid)
    imported = db.query(Order).one()
    imported.is_historical_archive = False
    imported.source_platform, imported.source_store = 'CBJ小程序', None
    source = db.query(OrderSource).one()
    source.platform, source.store = 'CBJ小程序', ''
    manual = order(db)
    admin = User(username='synthetic-repair-admin', password_hash='unused', role=UserRole.admin)
    db.add(admin)
    db.commit()
    return manual, imported, source, admin


def approve(plan, manual, duplicate):
    plan['resolutions'] = [{'keep_order_id': manual.id, 'duplicate_order_ids': [duplicate.id],
                            'keep_business_fields': True}]
    return plan


def test_repair_keeps_original_versions_and_link_history_and_is_idempotent(db):
    manual, duplicate, source, admin = setup_pair(db)
    before_snapshot = db.query(OrderSourceVersion).one().snapshot.copy()
    before_order_count = db.query(Order).count()
    plan = approve(preview_repair(db), manual, duplicate)
    result = apply_repair(db, plan, operator_id=admin.id, reason='合成数据核对后修复')
    assert result['voided_orders'] == 1
    assert db.query(Order).count() == before_order_count
    assert duplicate.status == OrderStatus.void and manual.status == OrderStatus.active
    assert source.platform == '微信小程序' and source.store == 'CBJ+'
    links = db.query(OrderSourceLink).all()
    assert {(row.order_id, row.active) for row in links} == {(duplicate.id, 0), (manual.id, 1)}
    assert db.query(OrderSourceVersion).one().snapshot == before_snapshot
    assert apply_repair(db, plan, operator_id=admin.id, reason='合成数据核对后修复')['already_applied']


def test_unapproved_or_stale_plan_does_not_write(db):
    manual, duplicate, source, admin = setup_pair(db)
    plan = preview_repair(db)
    with pytest.raises(HTTPException):
        apply_repair(db, plan, operator_id=admin.id, reason='合成修复')
    assert duplicate.status == OrderStatus.active and source.platform == 'CBJ小程序'
    approve(plan, manual, duplicate)
    manual.notes = '预览后发生修改'
    db.commit()
    with pytest.raises(HTTPException) as exc:
        apply_repair(db, plan, operator_id=admin.id, reason='合成修复')
    assert exc.value.status_code == 409
    assert source.platform == 'CBJ小程序'


def test_repair_refuses_duplicate_with_downstream_delivery(db):
    from app.models import PostalDelivery
    manual, duplicate, source, admin = setup_pair(db)
    db.add(PostalDelivery(order_id=duplicate.id, year=2026, delivery_no='SYNTHETIC-REPAIR',
                         recipient_name='合成订户', recipient_address='合成路', copies=1))
    db.commit()
    plan = approve(preview_repair(db), manual, duplicate)
    with pytest.raises(HTTPException):
        apply_repair(db, plan, operator_id=admin.id, reason='合成修复')
    assert source.platform == 'CBJ小程序' and duplicate.status == OrderStatus.active


def test_repair_failure_after_normalization_rolls_back_everything(db):
    manual, duplicate, source, admin = setup_pair(db)
    # 同一原件已在主单有关联，迁移必须拒绝重复金额归属，且回滚先前规范化。
    db.add(OrderSourceLink(source_id=source.id, order_id=manual.id, amount=199, active=1, reason='合成既有关联'))
    db.commit()
    plan = approve(preview_repair(db), manual, duplicate)
    with pytest.raises(HTTPException):
        apply_repair(db, plan, operator_id=admin.id, reason='合成失败回滚')
    assert source.platform == 'CBJ小程序'
    assert duplicate.status == OrderStatus.active
    assert db.query(OrderSourceLink).filter_by(active=1).count() == 2


def test_repair_requires_admin(db):
    manual, duplicate, _, admin = setup_pair(db)
    admin.role = UserRole.operator
    db.commit()
    plan = approve(preview_repair(db), manual, duplicate)
    with pytest.raises(HTTPException) as exc:
        apply_repair(db, plan, operator_id=admin.id, reason='合成权限校验')
    assert exc.value.status_code == 403


def test_source_collision_is_reported_without_modifying_versions(db):
    manual, duplicate, source, admin = setup_pair(db)
    db.add(OrderSource(platform='微信小程序', store='CBJ+', external_order_no=source.external_order_no,
                       kind='subscription', paid_amount=199))
    db.commit()
    plan = approve(preview_repair(db), manual, duplicate)
    assert len(plan['source_identity_conflicts']) == 1
    with pytest.raises(HTTPException):
        apply_repair(db, plan, operator_id=admin.id, reason='合成原件冲突')
    assert db.query(OrderSource).count() == 2


def test_preview_omits_personal_data_and_does_not_flush(db):
    import json
    manual, _, _, _ = setup_pair(db)
    plan = preview_repair(db)
    manual.notes = '尚未提交的修改'
    with pytest.raises(HTTPException):
        preview_repair(db)
    assert manual in db.dirty
    text = json.dumps(plan, ensure_ascii=False)
    assert '合成订户' not in text and '00000000000' not in text and 'SYNTHETIC-IDENTITY' not in text
