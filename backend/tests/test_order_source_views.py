"""标准来源贯穿筛选、统计、导出及邮局，保留原始字段。"""
import subprocess
import sys
from pathlib import Path

from app.api.orders import order_portal_summary
from app.models import OrderItem
from app.models.order_item import FulfillmentType, Publication
from app.services.order_coverage_service import list_candidates
from app.services.order_service import _filtered_order_query, list_orders
from test_order_source_identity import db, order


def test_source_catalog_is_generated_from_backend():
    script = Path(__file__).resolve().parents[2] / 'scripts/generate_sales_sources.py'
    subprocess.run([sys.executable, str(script), '--check'], check=True)


def test_aliases_share_list_coverage_and_portal_bucket(db):
    first = order(db)
    second = order(db, 'CBJ小程序', None)
    for row in (first, second):
        db.add(OrderItem(order_id=row.id, publication=Publication.cbj,
                        fulfillment_type=FulfillmentType.subscription, total_quantity=1, unit_price=199, subtotal=199))
    db.commit()
    assert _filtered_order_query(db, source_platform='微信小程序').count() == 2
    assert _filtered_order_query(db, source_platform='CBJ小程序').count() == 2
    assert list_candidates(db, 1, source_platform='微信小程序').total == 2
    assert order_portal_summary(db=db, _user=None)['channels'] == [{'label': '微信小程序', 'count': 2}]
    rows, total = list_orders(db, source_platform='微信小程序')
    assert total == 2 and {row.source_platform for row in rows} == {'微信小程序'}
    assert second.source_platform == 'CBJ小程序'  # 读取不写库。


def test_postal_and_finance_filters_accept_legacy_alias(db):
    from app.models import PostalDelivery, PostalFinance
    from app.services.postal_delivery_service import _deliveries_query
    from app.services.postal_finance_service import _finance_query
    for n, label in enumerate(['CBJ+小程序', 'CBJ+', '微信小程序', '商学院有赞']):
        db.add(PostalDelivery(year=2026, delivery_no=f'SYNTHETIC-{n}', recipient_name='合成订户', recipient_address='合成地址', copies=1, source_channel=label))
        db.add(PostalFinance(platform=label))
    db.commit()
    assert _deliveries_query(db, channel='微信小程序').count() == 3
    assert _finance_query(db, platform='微信小程序').count() == 3
    assert _deliveries_query(db, channel='商学院有赞').count() == 1
