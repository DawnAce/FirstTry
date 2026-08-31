import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "e7b9c1d3f5a8_add_waybill_documents_and_consolidation_preview.py"
    )
    spec = importlib.util.spec_from_file_location("waybill_document_migration", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_waybill_document_migration_round_trip(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'migration.db'}")
    metadata = sa.MetaData()
    sa.Table(
        "shipping_waybill_import_batches",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
    )
    sa.Table(
        "shipping_waybill_import_rows",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("batch_id", sa.Integer(), nullable=False),
    )
    sa.Table(
        "shipping_packages",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
    )
    metadata.create_all(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        inspector = sa.inspect(connection)
        assert {
            "consolidation_deferral_ids",
            "consolidation_issue_numbers",
            "consolidation_quantity",
        }.issubset({column["name"] for column in inspector.get_columns("shipping_waybill_import_rows")})
        document_columns = {
            column["name"] for column in inspector.get_columns("shipping_waybill_import_documents")
        }
        assert {"linked_import_row_id", "shipping_package_id", "status", "extracted_data"}.issubset(
            document_columns
        )

        migration.downgrade()
        inspector = sa.inspect(connection)
        assert "shipping_waybill_import_documents" not in inspector.get_table_names()
        row_columns = {
            column["name"] for column in inspector.get_columns("shipping_waybill_import_rows")
        }
        assert "consolidation_quantity" not in row_columns
