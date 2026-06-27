"""Integration tests for ``order_service.list_orders`` filtering + pagination.

Uses a real in-memory SQLite session (the FakeDb unit tests in
``test_order_service.py`` no-op offset/limit and SQL filters, so real
pagination/date-filter correctness can only be exercised against a real DB).

Covers two correctness fixes:

* ``order_date_start`` / ``order_date_end`` is a server-side filter — it must
  hold across pages, not only the current page.
* ``has_drift`` is a Python-computed predicate: the full filtered set must be
  drift-filtered *before* paginating, and ``total`` must reflect the post-drift
  count so every page is full and the count matches what's returned.
"""

import os
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("MYSQL_USER", "test")
os.environ.setdefault("MYSQL_PASSWORD", "test")
os.environ.setdefault("MYSQL_DATABASE", "test")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    FulfillmentType,
    Order,
    OrderEntryMethod,
    OrderItem,
    OrderStatus,
    Publication,
    PublicationFormat,
)
from app.services import order_service


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


def _order(db, *, order_date, expected_at_creation, status=OrderStatus.active):
    """One active order with a single ``single_issue`` item.

    ``single_issue`` always currently-expects 1 issue (no schedule needed), so
    setting ``expected_issues_at_creation`` != 1 deterministically forces drift
    and == 1 forces no-drift — without seeding any publication schedule.
    """
    order = Order(
        order_date=order_date,
        entry_method=OrderEntryMethod.excel_import,
        payer_name="X",
        status=status,
        total_amount=Decimal("100"),
        paid_amount=Decimal("100"),
    )
    db.add(order)
    db.flush()
    item = OrderItem(
        order_id=order.id,
        publication=Publication.cbj,
        publication_format=PublicationFormat.paper,
        fulfillment_type=FulfillmentType.single_issue,
        total_quantity=1,
        unit_price=Decimal("100"),
        subtotal=Decimal("100"),
        expected_issues_at_creation=expected_at_creation,
    )
    db.add(item)
    db.commit()
    return order


# ---------------------------------------------------------------------------
# bug #4 — order_date range is a SERVER-side filter
# ---------------------------------------------------------------------------


def test_order_date_range_filters_at_db_level(db):
    _order(db, order_date=date(2026, 1, 1), expected_at_creation=1)
    _order(db, order_date=date(2026, 3, 1), expected_at_creation=1)
    _order(db, order_date=date(2026, 5, 1), expected_at_creation=1)

    rows, total = order_service.list_orders(
        db, order_date_start=date(2026, 2, 1), order_date_end=date(2026, 4, 1)
    )
    assert total == 1
    assert len(rows) == 1
    assert rows[0].order_date == date(2026, 3, 1)


def test_order_date_range_holds_across_pages(db):
    # 5 in-range + 2 out-of-range; a 2-per-page query must page only the 5.
    for d in (
        date(2026, 2, 2),
        date(2026, 2, 5),
        date(2026, 2, 10),
        date(2026, 2, 20),
        date(2026, 2, 28),
    ):
        _order(db, order_date=d, expected_at_creation=1)
    _order(db, order_date=date(2026, 1, 1), expected_at_creation=1)   # out of range
    _order(db, order_date=date(2026, 3, 15), expected_at_creation=1)  # out of range

    rng = dict(order_date_start=date(2026, 2, 1), order_date_end=date(2026, 2, 28))
    page1, total = order_service.list_orders(db, skip=0, limit=2, **rng)
    assert total == 5
    assert len(page1) == 2

    page3, total3 = order_service.list_orders(db, skip=4, limit=2, **rng)
    assert total3 == 5
    assert len(page3) == 1
    assert all(date(2026, 2, 1) <= r.order_date <= date(2026, 2, 28) for r in page3)


# ---------------------------------------------------------------------------
# bug #3 — has_drift filter paginates correctly + reports post-filter total
# ---------------------------------------------------------------------------


def test_has_drift_filter_pages_are_full_and_total_is_post_filter(db):
    for _ in range(5):  # drift: baseline 2 != current 1
        _order(db, order_date=date(2026, 2, 1), expected_at_creation=2)
    for _ in range(3):  # no drift: baseline 1 == current 1
        _order(db, order_date=date(2026, 2, 1), expected_at_creation=1)

    page1, total = order_service.list_orders(db, has_drift=True, skip=0, limit=2)
    assert total == 5            # post-drift count, NOT 8
    assert len(page1) == 2       # full page (old bug short-filled after slicing)
    assert all(r.has_drift for r in page1)

    page3, total3 = order_service.list_orders(db, has_drift=True, skip=4, limit=2)
    assert total3 == 5
    assert len(page3) == 1       # the 5th drifting order
    assert all(r.has_drift for r in page3)


def test_has_drift_false_returns_only_non_drift(db):
    for _ in range(5):
        _order(db, order_date=date(2026, 2, 1), expected_at_creation=2)  # drift
    for _ in range(3):
        _order(db, order_date=date(2026, 2, 1), expected_at_creation=1)  # no drift

    rows, total = order_service.list_orders(db, has_drift=False)
    assert total == 3
    assert all(not r.has_drift for r in rows)


def test_no_drift_filter_paginates_in_sql_with_db_total(db):
    for _ in range(3):
        _order(db, order_date=date(2026, 2, 1), expected_at_creation=2)

    rows, total = order_service.list_orders(db, skip=0, limit=2)
    assert total == 3       # DB-level count (no drift filter)
    assert len(rows) == 2   # SQL-paginated
