import unittest
from pathlib import Path


class AlembicSchemaCoverageTests(unittest.TestCase):
    def test_base_migration_bootstraps_users_without_legacy_tables(self):
        migration = (
            Path(__file__).resolve().parents[1]
            / "alembic"
            / "versions"
            / "bfb95ba4d856_create_all_tables.py"
        ).read_text(encoding="utf-8")

        self.assertIn("create_table('users'", migration)
        self.assertIn("create_table('shipping_details'", migration)
        self.assertIn("sa.Column('city', sa.String(length=50)", migration)
        self.assertIn("DROP TABLE IF EXISTS `user`", migration)
        self.assertIn("DROP TABLE IF EXISTS `product`", migration)

    def test_migrations_create_issue_audit_snapshots_table(self):
        versions_dir = Path(__file__).resolve().parents[1] / "alembic" / "versions"
        migration_text = "\n".join(path.read_text(encoding="utf-8") for path in versions_dir.glob("*.py"))

        self.assertIn("create_table", migration_text)
        self.assertIn("'issue_audit_snapshots'", migration_text)
        self.assertIn("ForeignKeyConstraint(['issue_id'], ['issues.id']", migration_text)
        self.assertIn("snapshot_type", migration_text)
        self.assertIn('"fk_ft_replaced_by_target_id"', migration_text)
