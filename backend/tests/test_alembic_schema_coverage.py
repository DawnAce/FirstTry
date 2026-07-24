import unittest
from pathlib import Path


class AlembicSchemaCoverageTests(unittest.TestCase):
    def test_migrations_create_issue_audit_snapshots_table(self):
        versions_dir = Path(__file__).resolve().parents[1] / "alembic" / "versions"
        migration_text = "\n".join(path.read_text(encoding="utf-8") for path in versions_dir.glob("*.py"))

        self.assertIn("create_table", migration_text)
        self.assertIn("'issue_audit_snapshots'", migration_text)
        self.assertIn("ForeignKeyConstraint(['issue_id'], ['issues.id']", migration_text)
        self.assertIn("snapshot_type", migration_text)
        self.assertIn('"fk_ft_replaced_by_target_id"', migration_text)
