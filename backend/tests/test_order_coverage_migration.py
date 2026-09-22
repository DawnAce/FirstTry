"""只在隔离数据库验证起投字段迁移；不读取业务连接信息。"""
import importlib.util
import os
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text


def migration():
    path = Path(__file__).parents[1] / 'alembic/versions/c9e1f3a5b7d0_add_order_coverage_start.py'
    spec = importlib.util.spec_from_file_location('coverage_migration', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_coverage_migration_roundtrip_preserves_legacy_dates():
    engine = create_engine('sqlite:///:memory:')
    with engine.begin() as db:
        db.execute(text('CREATE TABLE order_items (id INTEGER PRIMARY KEY, coverage_start_date DATE, unit_price NUMERIC)'))
        db.execute(text("INSERT INTO order_items VALUES (1, '2026-06-08', 199)"))
        m = migration()
        m.op = Operations(MigrationContext.configure(db))
        m.upgrade()
        assert db.execute(text('SELECT coverage_start_mode, coverage_start_issue FROM order_items')).one() == (None, None)
        m.downgrade()
        assert {c['name'] for c in inspect(db).get_columns('order_items')} == {'id', 'coverage_start_date', 'unit_price'}
        assert db.execute(text('SELECT coverage_start_date, unit_price FROM order_items')).one() == ('2026-06-08', 199)


def test_coverage_mysql_migration_roundtrip():
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        pytest.skip('仅在 GitHub CI 的空 MySQL 验证迁移往返')
    from app.database import engine
    if engine.url.get_backend_name() != 'mysql' or engine.url.host not in {'127.0.0.1', 'localhost'} or engine.url.database != 'ci':
        pytest.skip('不是明确的 CI 临时 MySQL')
    with engine.begin() as db:
        m = migration()
        m.op = Operations(MigrationContext.configure(db))
        try:
            m.downgrade()
            assert 'coverage_start_mode' not in {c['name'] for c in inspect(db).get_columns('order_items')}
        finally:
            m.upgrade()
        assert {'coverage_start_mode', 'coverage_start_issue'} <= {c['name'] for c in inspect(db).get_columns('order_items')}
