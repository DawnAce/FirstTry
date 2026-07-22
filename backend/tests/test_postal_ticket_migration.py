"""PR-E 工单物理合表迁移的升级 / 降级数据往返测试。"""

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration():
    path = (
        Path(__file__).parents[1]
        / "alembic"
        / "versions"
        / "d4e6f8a0b2c4_unify_postal_tickets.py"
    )
    spec = importlib.util.spec_from_file_location("postal_ticket_migration", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def _create_dependencies(metadata):
    for table_name in ("orders", "partners", "users", "postal_delivery"):
        sa.Table(table_name, metadata, sa.Column("id", sa.Integer(), primary_key=True))


def test_postal_ticket_migration_round_trip(tmp_path):
    engine = sa.create_engine(f"sqlite:///{(tmp_path / 'postal.sqlite').as_posix()}")
    metadata = sa.MetaData()
    _create_dependencies(metadata)
    metadata.create_all(engine)
    migration = _load_migration()

    with engine.begin() as conn:
        migration.op = Operations(MigrationContext.configure(conn))
        migration._create_legacy_tables()
        conn.execute(sa.text("""
            INSERT INTO postal_complaints
            (id, external_order_no, complaint_date, year, missing_issues, status)
            VALUES (1, '2026-901', '2026-07-20', 2026, '少报一期', 'open')
        """))
        conn.execute(sa.text("""
            INSERT INTO postal_address_changes
            (id, external_order_no, change_date, old_name, new_address, applied_to_order)
            VALUES (1, '2026-902', '2026-07-21', '赵六', '新地址', 0)
        """))
        conn.execute(sa.text("""
            INSERT INTO postal_follow_ups
            (id, external_order_no, follow_up_date, batch_label, result, snap_name)
            VALUES (1, '2026-901', '2026-07-22', '20260722回访', '已补投', '王五')
        """))
        conn.execute(sa.text("""
            INSERT INTO postal_complaint_handling_records
            (id, complaint_id, action, result_status)
            VALUES (1, 1, '联系投递站', 'in_progress')
        """))

        migration.upgrade()
        assert conn.scalar(sa.text("SELECT COUNT(*) FROM postal_tickets")) == 3
        assert conn.scalar(sa.text("SELECT COUNT(*) FROM postal_ticket_events")) == 2
        assert conn.scalar(sa.text(
            "SELECT parent_ticket_id FROM postal_tickets WHERE type='follow'"
        )) == 1
        tables = set(sa.inspect(conn).get_table_names())
        assert "postal_tickets" in tables
        assert "postal_complaints" not in tables

        migration.downgrade()
        assert conn.scalar(sa.text("SELECT COUNT(*) FROM postal_complaints")) == 1
        assert conn.scalar(sa.text("SELECT COUNT(*) FROM postal_address_changes")) == 1
        assert conn.scalar(sa.text("SELECT COUNT(*) FROM postal_follow_ups")) == 1
        assert conn.scalar(sa.text(
            "SELECT COUNT(*) FROM postal_complaint_handling_records"
        )) == 1

        migration.upgrade()
        assert conn.scalar(sa.text("SELECT COUNT(*) FROM postal_tickets")) == 3
    engine.dispose()
