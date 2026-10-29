"""隔离库验证新增表与机构映射，不读取或改写业务数据库。"""
import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text


def test_channel_demand_upgrade_downgrade_preserves_partner_identity():
    path = Path(__file__).parents[1] / 'alembic/versions/d0e2f4a6b8c1_add_channel_demands.py'
    spec = importlib.util.spec_from_file_location('channel_migration', path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine('sqlite:///:memory:')
    with engine.begin() as connection:
        for table in ['users', 'contracts']:
            connection.execute(text(f'CREATE TABLE {table} (id INTEGER PRIMARY KEY)'))
        connection.execute(text('CREATE TABLE partners (id INTEGER PRIMARY KEY, name VARCHAR(128))'))
        connection.execute(text("INSERT INTO partners VALUES (7, '成都邮征天下（成都杂志铺）'), (8, '北京市报刊发行局'), (9, '合成机构')"))
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        assert connection.execute(text('SELECT partner_id, category, pricing_policy FROM channel_demand_profiles ORDER BY partner_id')).all() == [(7, 'chengdu', 'chengdu_annual'), (8, 'postal', 'unpriced')]
        connection.execute(text("UPDATE partners SET name='合成改名' WHERE id=7"))
        assert connection.execute(text("SELECT partner_id FROM channel_demand_profiles WHERE category='chengdu'")).scalar() == 7
        migration.downgrade()
        assert set(inspect(connection).get_table_names()) == {'users', 'partners', 'contracts'}
        assert connection.execute(text('SELECT COUNT(*) FROM partners')).scalar() == 3
        migration.upgrade()
        assert 'channel_demand_adoptions' in inspect(connection).get_table_names()
    engine.dispose()
