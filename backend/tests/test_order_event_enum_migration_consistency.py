import unittest
from pathlib import Path

from app.models.order_event import OrderEventType


class OrderEventEnumMigrationConsistencyTests(unittest.TestCase):
    """Guard against model<->migration drift for order_events.event_type.

    The model defines OrderEventType, but the *database* enum is whatever the
    alembic migrations declare. If a value is added to the model (and emitted by
    order_service, e.g. on active-order item edits) without a matching migration,
    inserts fail on MySQL — while the SQLite test suite (which builds tables from
    models via Base.metadata.create_all, not from migrations) stays green and
    hides it. That is exactly how item_added/item_removed/item_modified shipped
    in V1.2 while missing from the ordereventtype enum. This test pins the model
    and the migrations together so the drift cannot recur silently.

    It deliberately mirrors test_alembic_schema_coverage.py: it reads the
    migration *text* rather than running migrations (the suite never executes
    alembic), and uses only the stdlib so it runs under plain `unittest`.
    """

    def _migration_text(self) -> str:
        versions_dir = Path(__file__).resolve().parents[1] / "alembic" / "versions"
        return "\n".join(
            path.read_text(encoding="utf-8") for path in versions_dir.glob("*.py")
        )

    def test_every_model_event_type_is_declared_in_some_migration(self):
        text = self._migration_text()
        missing = [
            event.value
            for event in OrderEventType
            if f'"{event.value}"' not in text and f"'{event.value}'" not in text
        ]
        self.assertEqual(
            missing,
            [],
            "OrderEventType values not declared in any alembic migration: "
            f"{missing}. The database ordereventtype enum is built from migrations, "
            "so every model value an INSERT can emit must appear in one. Add an "
            "alembic migration that ALTERs order_events.event_type to include it.",
        )

    def test_item_events_present_regression_anchor(self):
        # Explicit anchor for the V1.2 drift fixed by migration b4d6f8a1c3e5.
        text = self._migration_text()
        for value in ("item_added", "item_removed", "item_modified"):
            self.assertTrue(
                f'"{value}"' in text or f"'{value}'" in text,
                f"{value} must be declared in an alembic ordereventtype enum "
                "migration (order_service emits it on active-order item edits).",
            )


if __name__ == "__main__":
    unittest.main()
