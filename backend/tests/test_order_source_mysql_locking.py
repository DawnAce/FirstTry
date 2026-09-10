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
