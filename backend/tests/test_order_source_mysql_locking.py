"""仅 GitHub CI 的空 MySQL 验证当前读，禁止连接用户业务数据库。"""
import os
import pytest


def test_shipping_write_reads_current_targets_after_other_transaction():
    if os.environ.get("GITHUB_ACTIONS") != "true":
        pytest.skip("仅在 GitHub CI 的空 MySQL 验证锁与快照")
    from app.database import engine
    if engine.url.get_backend_name() != "mysql" or engine.url.host not in {"127.0.0.1", "localhost"} or engine.url.database != "ci":
        pytest.skip("不是明确的 CI 临时 MySQL")
    from sqlalchemy.orm import Session
    from app.models import Order, OrderItem, FulfillmentAllocation, FulfillmentTarget
    from app.services.order_shipping_sync_service import _get_order
    from test_order_sources import subscription
    order_id = None
    with Session(engine) as first, Session(engine) as second:
        try:
            order, item, target = subscription(first, external="SYNTHETIC-MYSQL-LOCK")
            order_id = order.id
            target_id = target.id
            assert first.get(FulfillmentTarget, target_id).recipient_address == "合成路1号"
            other = second.get(FulfillmentTarget, target_id)
            other.recipient_address = "合成已变更地址"
            second.commit()
            current = _get_order(first, order_id, lock=True)
            assert current.items[0].allocations[0].targets[0].recipient_address == "合成已变更地址"
        finally:
            first.rollback()
            second.rollback()
            if order_id is not None:
                ids = second.query(OrderItem.id).filter_by(order_id=order_id)
                second.query(FulfillmentTarget).filter(FulfillmentTarget.order_item_id.in_(ids)).delete(synchronize_session=False)
                second.query(FulfillmentAllocation).filter(FulfillmentAllocation.order_item_id.in_(ids)).delete(synchronize_session=False)
                second.query(OrderItem).filter_by(order_id=order_id).delete(synchronize_session=False)
                second.query(Order).filter_by(id=order_id).delete(synchronize_session=False)
                second.commit()


def test_source_identity_lock_survives_business_commit_and_releases_on_failure():
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        pytest.skip('仅在 GitHub CI 的空 MySQL 验证命名锁')
    from hashlib import sha256
    from sqlalchemy import text
    from sqlalchemy.orm import Session
    from app.database import engine
    from app.services.order_source_identity import serialized_identity
    if engine.url.host not in {'127.0.0.1', 'localhost'} or engine.url.database != 'ci':
        pytest.skip('不是明确的 CI 临时 MySQL')
    key = 'order-source:' + sha256(str(engine.url.database).encode()).hexdigest()[:32]
    with engine.connect() as observer, Session(engine) as db:
        @serialized_identity
        def operation(session):
            session.execute(text('SELECT 1'))
            session.commit()
            assert observer.execute(text('SELECT GET_LOCK(:key, 0)'), {'key': key}).scalar() == 0
            raise ValueError('synthetic failure')
        with pytest.raises(ValueError, match='synthetic'):
            operation(db)
        assert observer.execute(text('SELECT GET_LOCK(:key, 0)'), {'key': key}).scalar() == 1
        observer.execute(text('SELECT RELEASE_LOCK(:key)'), {'key': key})


def test_identity_repair_round_trip_on_empty_ci_mysql():
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        pytest.skip('仅在 GitHub CI 的空 MySQL 验证修复事务')
    from sqlalchemy.orm import Session
    from app.database import engine
    if engine.url.host not in {'127.0.0.1', 'localhost'} or engine.url.database != 'ci':
        pytest.skip('不是明确的 CI 临时 MySQL')
    from datetime import date
    from app.models import Order, OrderStatus, OrderEntryMethod, OrderEvent
    from app.models.user import User, UserRole
    from app.models.order_source import OrderSource, OrderSourceVersion, OrderSourceLink, OrderSourceEvent
    from app.models.operation_log import OperationLog
    from app.services.order_source_repair_service import preview_repair, apply_repair
    with Session(engine) as db:
        source_id = user_id = None
        order_ids = []
        plan = None
        try:
            user = User(username='synthetic-mysql-repair', password_hash='unused', role=UserRole.admin)
            db.add(user)
            db.flush()
            user_id = user.id
            keep = Order(order_date=date(2026, 1, 1), payer_name='合成修复测试', status=OrderStatus.active,
                         entry_method=OrderEntryMethod.manual, external_order_no='SYNTHETIC-MYSQL-REPAIR',
                         source_platform='微信小程序', source_store='CBJ+', total_amount=5, paid_amount=5)
            duplicate = Order(order_date=date(2026, 1, 1), payer_name='合成修复测试', status=OrderStatus.active,
                              entry_method=OrderEntryMethod.excel_import, external_order_no='SYNTHETIC-MYSQL-REPAIR',
                              source_platform='CBJ小程序', total_amount=5, paid_amount=5)
            source = OrderSource(platform='CBJ小程序', store='', external_order_no='SYNTHETIC-MYSQL-REPAIR', kind='subscription', paid_amount=5)
            db.add_all([keep, duplicate, source])
            db.flush()
            order_ids, source_id = [keep.id, duplicate.id], source.id
            db.add(OrderSourceVersion(source_id=source.id, revision=1, fingerprint='0' * 64, snapshot={'synthetic': True}, search_text='synthetic'))
            db.add(OrderSourceLink(source_id=source.id, order_id=duplicate.id, amount=5, active=1, reason='synthetic'))
            db.commit()
            plan = preview_repair(db)
            plan['resolutions'] = [{'keep_order_id': keep.id, 'duplicate_order_ids': [duplicate.id], 'keep_business_fields': True}]
            assert apply_repair(db, plan, operator_id=user_id, reason='CI 合成修复')['voided_orders'] == 1
            assert duplicate.status == OrderStatus.void
            assert db.query(OrderSourceVersion).filter_by(source_id=source.id).one().snapshot == {'synthetic': True}
            assert apply_repair(db, plan, operator_id=user_id, reason='CI 合成修复')['already_applied']
        finally:
            db.rollback()
            if source_id is not None:
                for model in (OrderSourceEvent, OrderSourceLink, OrderSourceVersion):
                    db.query(model).filter(model.source_id == source_id).delete(synchronize_session=False)
                db.query(OrderSource).filter_by(id=source_id).delete()
            db.query(OrderEvent).filter(OrderEvent.order_id.in_(order_ids)).delete(synchronize_session=False)
            db.query(Order).filter(Order.id.in_(order_ids)).delete(synchronize_session=False)
            if plan:
                db.query(OperationLog).filter(OperationLog.action == 'identity_repair', OperationLog.changes['plan_id'].as_string() == plan['plan_id']).delete(synchronize_session=False)
            if user_id is not None:
                db.query(User).filter_by(id=user_id).delete()
            db.commit()
