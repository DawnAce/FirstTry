"""Tests for order_code_service.

Uses a real in-memory SQLite session (like the sync/pricing service tests) so
the MAX-based sequencing and the batch block allocator are exercised against
actual SQL rather than a hand-rolled mock.
"""

from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Order, OrderEntryMethod, OrderStatus
from app.services import order_code_service


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


def _add_order(db, code, *, year=2026):
    db.add(
        Order(
            order_code=code,
            order_date=date(year, 3, 1),
            entry_method=OrderEntryMethod.manual,
            payer_name="X",
            status=OrderStatus.active,
        )
    )
    db.flush()


def test_first_code_when_empty(db):
    assert order_code_service.generate_order_code(db, 2026) == "ORD-2026-000001"


def test_next_after_existing(db):
    _add_order(db, "ORD-2026-000001")
    _add_order(db, "ORD-2026-000002")
    assert order_code_service.generate_order_code(db, 2026) == "ORD-2026-000003"


def test_year_isolation(db):
    _add_order(db, "ORD-2025-000042", year=2025)
    assert order_code_service.generate_order_code(db, 2025) == "ORD-2025-000043"
    assert order_code_service.generate_order_code(db, 2026) == "ORD-2026-000001"


def test_gap_safe_uses_max_not_count(db):
    # Codes 1 and 3 exist (2 was deleted). COUNT(*)+1 would re-issue 000003 and
    # collide on the unique constraint; max+1 must skip the gap to 000004.
    _add_order(db, "ORD-2026-000001")
    _add_order(db, "ORD-2026-000003")
    assert order_code_service.generate_order_code(db, 2026) == "ORD-2026-000004"


def test_allocate_block_is_contiguous(db):
    _add_order(db, "ORD-2026-000005")
    codes = order_code_service.allocate_order_codes(db, 2026, 3)
    assert codes == ["ORD-2026-000006", "ORD-2026-000007", "ORD-2026-000008"]


def test_allocate_from_empty_year(db):
    assert order_code_service.allocate_order_codes(db, 2026, 2) == [
        "ORD-2026-000001",
        "ORD-2026-000002",
    ]


def test_allocate_zero_returns_empty(db):
    assert order_code_service.allocate_order_codes(db, 2026, 0) == []


def test_allocate_negative_raises(db):
    with pytest.raises(ValueError):
        order_code_service.allocate_order_codes(db, 2026, -1)


def test_padding_past_six_digits_keeps_full_width(db):
    _add_order(db, "ORD-2026-1000000")
    assert order_code_service.generate_order_code(db, 2026) == "ORD-2026-1000001"
