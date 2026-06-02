"""Tests for order_code_service.

Uses the project's FakeDb pattern (see test_publication_schedule_upload_service.py)
to avoid hitting the real MySQL during unit tests.
"""

import pytest

from app.models import Order
from app.services import order_code_service


class FakeQuery:
    """Minimal stand-in that records what `like()` pattern was used and
    returns a configurable count."""

    def __init__(self, count_by_pattern):
        self._count_by_pattern = count_by_pattern
        self._pattern = None

    def filter(self, condition):
        # condition is `Order.order_code.like('ORD-2026-%')`. Extract the
        # right-hand value from the BinaryExpression so the test stays
        # simple without inspecting SQLAlchemy internals.
        self._pattern = str(condition.right.value)
        return self

    def count(self):
        return self._count_by_pattern.get(self._pattern, 0)


class FakeDb:
    def __init__(self, count_by_pattern):
        self._count_by_pattern = count_by_pattern

    def query(self, model):
        assert model is Order
        return FakeQuery(self._count_by_pattern)


def test_generates_padded_sequence_when_no_existing_orders():
    db = FakeDb({})
    code = order_code_service.generate_order_code(db, year=2026)
    assert code == "ORD-2026-000001"


def test_generates_next_after_existing():
    db = FakeDb({"ORD-2026-%": 7})
    code = order_code_service.generate_order_code(db, year=2026)
    assert code == "ORD-2026-000008"


def test_year_isolation():
    db = FakeDb({"ORD-2025-%": 42, "ORD-2026-%": 0})
    c25 = order_code_service.generate_order_code(db, year=2025)
    c26 = order_code_service.generate_order_code(db, year=2026)
    assert c25 == "ORD-2025-000043"
    assert c26 == "ORD-2026-000001"


def test_six_digit_padding_for_small_sequence():
    db = FakeDb({"ORD-2026-%": 0})
    code = order_code_service.generate_order_code(db, year=2026)
    assert code.split("-")[-1] == "000001"
    assert len(code.split("-")[-1]) == 6


def test_six_digit_padding_keeps_growing_past_million_minus_one():
    db = FakeDb({"ORD-2026-%": 999_998})
    code = order_code_service.generate_order_code(db, year=2026)
    assert code == "ORD-2026-999999"


def test_overflow_past_six_digits_keeps_full_width():
    # If we ever blow past 6 digits, the code should still be valid
    # (not truncated) so unique constraint still holds.
    db = FakeDb({"ORD-2026-%": 1_000_000})
    code = order_code_service.generate_order_code(db, year=2026)
    assert code == "ORD-2026-1000001"
