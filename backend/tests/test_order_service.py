"""Tests for order_service (V1.1).

Covers the simpler CRUD flows. The more complex confirm_order and
list_orders flows are tested in test_order_service_confirm.py and
test_order_service_list.py (Steps B and C).

Uses an in-memory FakeDb pattern (project convention) — no real DB.
"""

from datetime import date
from decimal import Decimal
from typing import Optional

import pytest
from fastapi import HTTPException

from app.models import (
    FulfillmentAllocation,
    FulfillmentTarget,
    Order,
    OrderEvent,
    OrderEventType,
    OrderItem,
    OrderSourceType,
    OrderStatus,
)
from app.models.fulfillment_target import ShippingChannel
from app.models.order_item import (
    BillingType,
    FulfillmentType,
    OrderItemStatus,
    Publication,
    PublicationFormat,
)
from app.schemas.order import (
    FulfillmentTargetIn,
    OrderCreate,
    OrderItemsUpdate,
    OrderItemIn,
    OrderItemUpdate,
    OrderUpdate,
)
from app.services import order_service


# ---------------------------------------------------------------------------
# Test doubles
# ---------------------------------------------------------------------------


class _FakeQuery:
    """A chainable query stub that returns a preset value on terminal calls."""

    def __init__(self, target=None, count_value: int = 0):
        self._target = target          # row to return from .first()
        self._count_value = count_value

    def options(self, *args, **kwargs):
        return self

    def filter(self, *args, **kwargs):
        return self

    def first(self):
        return self._target

    def count(self):
        return self._count_value


class FakeDb:
    """A minimal SQLAlchemy session stand-in.

    * ``add`` records every entity in ``self.added`` and assigns an id
      so subsequent ``.flush()`` calls leave ``id`` populated, mirroring
      the behaviour of an INSERT + flush in MySQL.
    * ``query(model)`` returns the next pre-configured ``_FakeQuery``
      from ``self.query_returns`` so tests can dictate what each
      ``db.query(...).filter(...).first()`` returns.
    """

    def __init__(self, query_returns=None):
        self.added = []
        self.flushed = 0
        self.committed = 0
        self.refreshed = []
        self._next_id = 1
        # FIFO of preconfigured FakeQuery results
        self.query_returns = list(query_returns or [])

    def add(self, obj):
        if getattr(obj, "id", None) is None:
            try:
                obj.id = self._next_id
                self._next_id += 1
            except AttributeError:
                pass
        self.added.append(obj)

    def add_all(self, objs):
        for o in objs:
            self.add(o)

    def flush(self):
        self.flushed += 1

    def commit(self):
        self.committed += 1

    def refresh(self, obj):
        self.refreshed.append(obj)

    def query(self, *args, **kwargs):
        if not self.query_returns:
            return _FakeQuery(target=None, count_value=0)
        return self.query_returns.pop(0)


def _make_order_create(
    *,
    targets_quantity=2,
    total_quantity=2,
    coverage_start=date(2026, 3, 1),
    coverage_end=date(2026, 12, 31),
) -> OrderCreate:
    return OrderCreate(
        order_date=date(2026, 3, 1),
        source_type=OrderSourceType.ecommerce,
        payer_name="Alice",
        payer_contact="13800000000",
        total_amount=Decimal("180"),
        items=[
            OrderItemIn(
                fulfillment_type=FulfillmentType.subscription,
                coverage_start_date=coverage_start,
                coverage_end_date=coverage_end,
                total_quantity=total_quantity,
                unit_price=Decimal("60"),
                subtotal=Decimal("180"),
                targets=[
                    FulfillmentTargetIn(
                        recipient_name=f"Recipient{i}",
                        recipient_address=f"Address {i}",
                        quantity=1,
                    )
                    for i in range(targets_quantity)
                ],
            ),
        ],
    )


# ---------------------------------------------------------------------------
# create_order_draft
# ---------------------------------------------------------------------------


def test_create_order_draft_persists_order_item_allocation_targets_event():
    db = FakeDb()
    data = _make_order_create(targets_quantity=2, total_quantity=2)

    order = order_service.create_order_draft(db, data, created_by=42)

    # One Order, one OrderItem, one FulfillmentAllocation, two FulfillmentTargets,
    # one OrderEvent — five distinct entity types.
    added_types = [type(o).__name__ for o in db.added]
    assert added_types.count("Order") == 1
    assert added_types.count("OrderItem") == 1
    assert added_types.count("FulfillmentAllocation") == 1
    assert added_types.count("FulfillmentTarget") == 2
    assert added_types.count("OrderEvent") == 1

    # Order set to draft, has no order_code yet.
    assert order.status == OrderStatus.draft
    assert order.order_code is None
    assert order.created_by == 42

    # Allocation is v1, no effective range, "initial" change_reason.
    alloc = next(o for o in db.added if isinstance(o, FulfillmentAllocation))
    assert alloc.version_no == 1
    assert alloc.change_reason == "initial"
    assert alloc.effective_from_issue is None

    # All targets reference the v1 allocation.
    targets = [o for o in db.added if isinstance(o, FulfillmentTarget)]
    assert all(t.allocation_id == alloc.id for t in targets)
    assert {t.recipient_name for t in targets} == {"Recipient0", "Recipient1"}

    # Audit event has correct type + payload.
    event = next(o for o in db.added if isinstance(o, OrderEvent))
    assert event.event_type == OrderEventType.created
    # V1.1: source_type 由服务端硬设为 manual，事件 payload 与持久化值一致
    assert event.payload_json == {"source_type": "manual", "items_count": 1}
    assert event.operator_id == 42

    # The transaction completed.
    assert db.committed == 1


def test_create_order_draft_normalizes_source_type_to_manual_regardless_of_client_input():
    """V1.1 PR-A invariant: create_order_draft must persist source_type=manual
    regardless of what the client passes in OrderCreate.source_type. The field is
    provenance metadata and only the service-layer entry point is allowed to set it.
    """
    db = FakeDb()
    # Client tries to claim the order is from ecommerce; service must ignore.
    data = _make_order_create()
    assert data.source_type == OrderSourceType.ecommerce, (
        "Pydantic should still accept the field; enforcement is at the service layer"
    )

    order = order_service.create_order_draft(db, data, created_by=1)

    # Persisted value is manual, not ecommerce.
    assert order.source_type == OrderSourceType.manual

    # Event payload also reflects manual, not the client-claimed value.
    event = next(o for o in db.added if isinstance(o, OrderEvent))
    assert event.payload_json["source_type"] == "manual"


def test_create_order_draft_supports_item_without_targets():
    """Draft can be saved without recipients so the operator can add them later."""
    db = FakeDb()
    data = OrderCreate(
        order_date=date(2026, 3, 1),
        source_type=OrderSourceType.manual,
        payer_name="No Targets",
        items=[
            OrderItemIn(
                fulfillment_type=FulfillmentType.single_issue,
                total_quantity=1,
            )
        ],
    )
    order = order_service.create_order_draft(db, data)
    assert order.status == OrderStatus.draft
    assert not [o for o in db.added if isinstance(o, FulfillmentTarget)]
    assert len([o for o in db.added if isinstance(o, FulfillmentAllocation)]) == 1


# ---------------------------------------------------------------------------
# void_order
# ---------------------------------------------------------------------------


def _seeded_order(status=OrderStatus.active, order_id=1, **overrides):
    kwargs = dict(
        order_date=date(2026, 3, 1),
        source_type=OrderSourceType.ecommerce,
        payer_name="X",
        status=status,
    )
    kwargs.update(overrides)
    order = Order(**kwargs)
    order.id = order_id
    return order


def test_void_order_sets_void_status_and_logs_event():
    seeded = _seeded_order(status=OrderStatus.active)
    db = FakeDb(query_returns=[_FakeQuery(target=seeded)])

    result = order_service.void_order(db, 1, reason="customer cancelled", operator_id=7)

    assert result.status == OrderStatus.void
    event = next(o for o in db.added if isinstance(o, OrderEvent))
    assert event.event_type == OrderEventType.voided
    assert event.payload_json == {"reason": "customer cancelled"}
    assert event.operator_id == 7
    assert db.committed == 1


def test_void_order_not_found_404():
    db = FakeDb(query_returns=[_FakeQuery(target=None)])
    with pytest.raises(HTTPException) as exc:
        order_service.void_order(db, 999, reason="x")
    assert exc.value.status_code == 404


def test_void_order_already_void_409():
    seeded = _seeded_order(status=OrderStatus.void)
    db = FakeDb(query_returns=[_FakeQuery(target=seeded)])
    with pytest.raises(HTTPException) as exc:
        order_service.void_order(db, 1, reason="x")
    assert exc.value.status_code == 409


# ---------------------------------------------------------------------------
# update_order
# ---------------------------------------------------------------------------


def test_update_order_draft_applies_changes_and_logs_diff():
    seeded = _seeded_order(status=OrderStatus.draft, payer_name="Old", notes=None)
    db = FakeDb(query_returns=[_FakeQuery(target=seeded)])
    upd = OrderUpdate(payer_name="New", notes="added")

    result = order_service.update_order(db, 1, upd, operator_id=5)

    assert result.payer_name == "New"
    assert result.notes == "added"
    event = next(o for o in db.added if isinstance(o, OrderEvent))
    assert event.event_type == OrderEventType.modified
    assert event.payload_json["diff"]["payer_name"] == {"from": "Old", "to": "New"}
    assert event.payload_json["diff"]["notes"] == {"from": None, "to": "added"}


def test_update_order_active_allows_notes_field():
    seeded = _seeded_order(status=OrderStatus.active, notes=None)
    db = FakeDb(query_returns=[_FakeQuery(target=seeded)])
    upd = OrderUpdate(notes="ok")
    result = order_service.update_order(db, 1, upd)
    assert result.notes == "ok"


def test_update_order_active_rejects_structural_field():
    seeded = _seeded_order(status=OrderStatus.active, payer_name="Old")
    db = FakeDb(query_returns=[_FakeQuery(target=seeded)])
    upd = OrderUpdate(payer_name="Changed")
    with pytest.raises(HTTPException) as exc:
        order_service.update_order(db, 1, upd)
    assert exc.value.status_code == 422
    assert "payer_name" in str(exc.value.detail)


def test_update_order_voided_409():
    seeded = _seeded_order(status=OrderStatus.void)
    db = FakeDb(query_returns=[_FakeQuery(target=seeded)])
    with pytest.raises(HTTPException) as exc:
        order_service.update_order(db, 1, OrderUpdate(notes="x"))
    assert exc.value.status_code == 409


def test_update_order_no_changes_does_not_log_event():
    """If exclude_unset payload is empty or values are identical, skip event."""
    seeded = _seeded_order(status=OrderStatus.draft, notes="same")
    db = FakeDb(query_returns=[_FakeQuery(target=seeded)])
    upd = OrderUpdate(notes="same")
    order_service.update_order(db, 1, upd)
    assert not [o for o in db.added if isinstance(o, OrderEvent)]


# ---------------------------------------------------------------------------
# get_order_detail
# ---------------------------------------------------------------------------


def _seed_active_order_for_item_updates() -> Order:
    order = _seeded_order(status=OrderStatus.active, order_id=1, payer_name="Alice")

    item1 = OrderItem(
        order_id=order.id,
        fulfillment_type=FulfillmentType.subscription,
        total_quantity=1,
        unit_price=Decimal("390.00"),
        subtotal=Decimal("390.00"),
        coverage_start_date=date(2026, 3, 1),
        coverage_end_date=date(2026, 12, 31),
        notes="old note",
        status=OrderItemStatus.active,
    )
    item1.id = 10
    alloc1 = FulfillmentAllocation(
        order_item_id=item1.id,
        version_no=1,
        effective_from_issue=2601,
        effective_until_issue=None,
        change_reason="initial",
    )
    alloc1.id = 20
    target1 = FulfillmentTarget(
        order_item_id=item1.id,
        allocation_id=alloc1.id,
        recipient_name="Old Recipient",
        recipient_address="Old Address",
        quantity=1,
        shipping_channel=ShippingChannel.zto_outsource,
    )
    target1.id = 30
    alloc1.targets = [target1]
    item1.allocations = [alloc1]
    item1.targets = [target1]

    item2 = OrderItem(
        order_id=order.id,
        fulfillment_type=FulfillmentType.gift,
        total_quantity=1,
        unit_price=Decimal("0.00"),
        subtotal=Decimal("0.00"),
        status=OrderItemStatus.active,
        notes="remove me",
    )
    item2.id = 11
    alloc2 = FulfillmentAllocation(
        order_item_id=item2.id,
        version_no=1,
        effective_from_issue=2601,
        effective_until_issue=None,
        change_reason="initial",
    )
    alloc2.id = 21
    target2 = FulfillmentTarget(
        order_item_id=item2.id,
        allocation_id=alloc2.id,
        recipient_name="Gift Recipient",
        recipient_address="Gift Address",
        quantity=1,
        shipping_channel=ShippingChannel.zto_outsource,
    )
    target2.id = 31
    alloc2.targets = [target2]
    item2.allocations = [alloc2]
    item2.targets = [target2]

    order.items = [item1, item2]
    return order


def test_update_order_items_updates_existing_adds_new_and_cancels_missing_items():
    seeded = _seed_active_order_for_item_updates()
    db = FakeDb(query_returns=[_FakeQuery(target=seeded)])
    data = OrderItemsUpdate(
        effective_from_issue=2660,
        change_reason="customer moved",
        items=[
            OrderItemUpdate(
                id=10,
                fulfillment_type=FulfillmentType.subscription,
                total_quantity=1,
                unit_price=Decimal("390.00"),
                subtotal=Decimal("390.00"),
                coverage_start_date=date(2026, 3, 1),
                coverage_end_date=date(2026, 12, 31),
                notes="new note",
                targets=[
                    FulfillmentTargetIn(
                        recipient_name="New Recipient",
                        recipient_address="New Address",
                        quantity=1,
                    )
                ],
            ),
            OrderItemUpdate(
                fulfillment_type=FulfillmentType.single_issue,
                total_quantity=1,
                unit_price=Decimal("5.00"),
                subtotal=Decimal("5.00"),
                issue_number=2660,
                targets=[
                    FulfillmentTargetIn(
                        recipient_name="Added Recipient",
                        recipient_address="Added Address",
                        quantity=1,
                    )
                ],
            ),
        ],
    )

    result = order_service.update_order_items(db, 1, data, operator_id=7)

    existing_item = next(item for item in result.items if item.id == 10)
    removed_item = next(item for item in result.items if item.id == 11)
    added_item = next(item for item in db.added if isinstance(item, OrderItem) and item.id not in {10, 11})

    assert existing_item.notes == "new note"
    assert len(existing_item.allocations) == 2
    closed_alloc = next(a for a in existing_item.allocations if a.version_no == 1)
    new_alloc = next(a for a in existing_item.allocations if a.version_no == 2)
    assert closed_alloc.effective_until_issue == 2659
    assert new_alloc.effective_from_issue == 2660
    assert new_alloc.targets[0].recipient_name == "New Recipient"

    assert removed_item.status == OrderItemStatus.cancelled
    assert removed_item.allocations[0].effective_until_issue == 2659

    assert added_item.issue_number == 2660
    assert any(
        isinstance(obj, FulfillmentAllocation)
        and obj.order_item_id == added_item.id
        and obj.version_no == 1
        for obj in db.added
    )
    event_types = [obj.event_type for obj in db.added if isinstance(obj, OrderEvent)]
    assert OrderEventType.item_modified in event_types
    assert OrderEventType.item_removed in event_types
    assert OrderEventType.item_added in event_types
    assert db.committed == 1


def test_get_order_detail_returns_order():
    seeded = _seeded_order(status=OrderStatus.active)
    db = FakeDb(query_returns=[_FakeQuery(target=seeded)])
    result = order_service.get_order_detail(db, 1)
    assert result is seeded


def test_get_order_detail_not_found_404():
    db = FakeDb(query_returns=[_FakeQuery(target=None)])
    with pytest.raises(HTTPException) as exc:
        order_service.get_order_detail(db, 999)
    assert exc.value.status_code == 404


# ---------------------------------------------------------------------------
# compute_fulfillment_progress (delegates to expected_issues_calculator)
# ---------------------------------------------------------------------------


class _FakeCountMaxDb:
    """DB stub for expected_issues_calculator (COUNT vs MAX dispatch)."""

    def __init__(self, count=43, latest: Optional[date] = date(2026, 12, 31)):
        self.count = count
        self.latest = latest

    def query(self, expr):
        text = str(expr).lower()

        class _Q:
            def __init__(self_inner, value):
                self_inner._value = value

            def filter(self_inner, *a, **k):
                return self_inner

            def scalar(self_inner):
                return self_inner._value

        if "count" in text:
            return _Q(self.count)
        if "max" in text:
            return _Q(self.latest)
        return _Q(None)


def _make_subscription_item(expected_at_creation=42) -> OrderItem:
    item = OrderItem(
        order_id=1,
        fulfillment_type=FulfillmentType.subscription,
        coverage_start_date=date(2026, 3, 1),
        coverage_end_date=date(2026, 12, 31),
        expected_issues_at_creation=expected_at_creation,
        total_quantity=1,
    )
    item.id = 100
    return item


def test_compute_progress_no_drift_when_values_match():
    db = _FakeCountMaxDb(count=42, latest=date(2026, 12, 31))
    item = _make_subscription_item(expected_at_creation=42)
    progress = order_service.compute_fulfillment_progress(db, item)
    assert progress.expected_at_creation == 42
    assert progress.current_expected == 42
    assert progress.drift == 0
    assert progress.synced_count == 0
    assert progress.skipped_count == 0


def test_compute_progress_drift_positive_when_schedule_added_issue():
    db = _FakeCountMaxDb(count=43, latest=date(2026, 12, 31))
    item = _make_subscription_item(expected_at_creation=42)
    progress = order_service.compute_fulfillment_progress(db, item)
    assert progress.drift == 1


def test_compute_progress_drift_none_when_baseline_missing():
    db = _FakeCountMaxDb(count=42, latest=date(2026, 12, 31))
    item = _make_subscription_item(expected_at_creation=None)
    progress = order_service.compute_fulfillment_progress(db, item)
    assert progress.expected_at_creation is None
    assert progress.current_expected == 42
    assert progress.drift is None


def test_compute_progress_for_gift_item_returns_none_expected():
    db = _FakeCountMaxDb()
    item = OrderItem(
        order_id=1,
        fulfillment_type=FulfillmentType.gift,
        total_quantity=1,
    )
    item.id = 100
    progress = order_service.compute_fulfillment_progress(db, item)
    assert progress.current_expected is None
    assert progress.drift is None


# ---------------------------------------------------------------------------
# confirm_order
# ---------------------------------------------------------------------------


class _OrderQ:
    """Stub for ``db.query(Order)`` — supports both ``.first()`` and ``.count()``."""

    def __init__(self, first_value=None, count_value: int = 0):
        self._first = first_value
        self._count = count_value

    def options(self, *args, **kwargs):
        return self

    def filter(self, *args, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def offset(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def first(self):
        return self._first

    def count(self):
        return self._count

    def all(self):
        return [self._first] if self._first is not None else []


class _ScalarQ:
    """Stub for ``db.query(func.count(...))`` / ``func.max(...)``."""

    def __init__(self, value):
        self._value = value

    def filter(self, *args, **kwargs):
        return self

    def scalar(self):
        return self._value


class FakeConfirmDb:
    """Smart dispatcher for confirm_order's query shapes.

    Dispatches by inspecting the str() of the SQLAlchemy expression
    passed to ``db.query(...)``:

    * Contains ``count(`` → publication schedule COUNT query.
    * Contains ``max(``   → publication schedule MAX(publish_date) query.
    * Otherwise           → ``db.query(Order)`` — returns the seeded
      order from ``.first()`` and ``existing_code_count`` from ``.count()``.
    """

    def __init__(
        self,
        order: Order,
        existing_code_count: int = 0,
        schedule_count: int = 43,
        schedule_latest: Optional[date] = date(2026, 12, 31),
    ):
        self.order = order
        self.existing_code_count = existing_code_count
        self.schedule_count = schedule_count
        self.schedule_latest = schedule_latest
        self.added = []
        self.flushed = 0
        self.committed = 0
        self.refreshed = []
        self._next_id = 1000

    def add(self, obj):
        if getattr(obj, "id", None) is None:
            try:
                obj.id = self._next_id
                self._next_id += 1
            except AttributeError:
                pass
        self.added.append(obj)

    def add_all(self, objs):
        for o in objs:
            self.add(o)

    def flush(self):
        self.flushed += 1

    def commit(self):
        self.committed += 1

    def refresh(self, obj):
        self.refreshed.append(obj)

    def query(self, *args):
        text = str(args[0]).lower() if args else ""
        if "count(" in text:
            # COUNT(publication_schedule.id) -> schedule count
            return _ScalarQ(self.schedule_count)
        if "max(" in text:
            return _ScalarQ(self.schedule_latest)
        # Otherwise it's db.query(Order)
        return _OrderQ(first_value=self.order, count_value=self.existing_code_count)


def _seeded_draft_with_items(items_data=None) -> Order:
    """Build a Draft order with attached OrderItem instances (no DB)."""
    order = _seeded_order(status=OrderStatus.draft, order_id=1, payer_name="Alice")
    order.order_code = None
    items = []
    items_data = items_data or [
        {"fulfillment_type": FulfillmentType.subscription,
         "coverage_start_date": date(2026, 3, 1),
         "coverage_end_date": date(2026, 12, 31)},
    ]
    for idx, d in enumerate(items_data, start=10):
        item = OrderItem(
            order_id=order.id,
            fulfillment_type=d["fulfillment_type"],
            coverage_start_date=d.get("coverage_start_date"),
            coverage_end_date=d.get("coverage_end_date"),
            total_quantity=1,
        )
        item.id = idx
        items.append(item)
    order.items = items
    return order


def test_confirm_order_generates_code_and_transitions_to_active():
    seeded = _seeded_draft_with_items()
    db = FakeConfirmDb(order=seeded, existing_code_count=5)

    result = order_service.confirm_order(db, 1, operator_id=42)

    assert result.status == OrderStatus.active
    # 6th order in 2026 -> ORD-2026-000006
    assert result.order_code == "ORD-2026-000006"
    event = next(o for o in db.added if isinstance(o, OrderEvent))
    assert event.event_type == OrderEventType.confirmed
    assert event.payload_json == {"order_code": "ORD-2026-000006"}
    assert event.operator_id == 42
    assert db.committed == 1


def test_confirm_order_preserves_existing_code():
    seeded = _seeded_draft_with_items()
    seeded.order_code = "ORD-2026-PREASSIGNED"
    db = FakeConfirmDb(order=seeded, existing_code_count=999)
    result = order_service.confirm_order(db, 1)
    assert result.order_code == "ORD-2026-PREASSIGNED"


def test_confirm_order_snapshots_expected_issues_for_subscription():
    seeded = _seeded_draft_with_items([
        {"fulfillment_type": FulfillmentType.subscription,
         "coverage_start_date": date(2026, 3, 1),
         "coverage_end_date": date(2026, 12, 31)},
    ])
    db = FakeConfirmDb(order=seeded, schedule_count=43, schedule_latest=date(2026, 12, 31))
    result = order_service.confirm_order(db, 1)
    item = result.items[0]
    # subscription, schedule covers whole period -> 43
    assert item.expected_issues_at_creation == 43


def test_confirm_order_snapshots_expected_issues_for_mixed_item_types():
    """Subscription -> count from schedule; single_issue -> 1; gift -> None."""
    seeded = _seeded_draft_with_items([
        {"fulfillment_type": FulfillmentType.subscription,
         "coverage_start_date": date(2026, 1, 1),
         "coverage_end_date": date(2026, 12, 31)},
        {"fulfillment_type": FulfillmentType.single_issue},
        {"fulfillment_type": FulfillmentType.gift},
    ])
    db = FakeConfirmDb(order=seeded, schedule_count=50, schedule_latest=date(2026, 12, 31))
    result = order_service.confirm_order(db, 1)
    expected = [i.expected_issues_at_creation for i in result.items]
    assert expected == [50, 1, None]


def test_confirm_order_idempotent_already_active_409():
    seeded = _seeded_order(status=OrderStatus.active)
    seeded.items = []
    db = FakeConfirmDb(order=seeded)
    with pytest.raises(HTTPException) as exc:
        order_service.confirm_order(db, 1)
    assert exc.value.status_code == 409
    assert "already active" in str(exc.value.detail)


def test_confirm_order_voided_409():
    seeded = _seeded_order(status=OrderStatus.void)
    seeded.items = []
    db = FakeConfirmDb(order=seeded)
    with pytest.raises(HTTPException) as exc:
        order_service.confirm_order(db, 1)
    assert exc.value.status_code == 409
    assert "voided" in str(exc.value.detail)


def test_confirm_order_not_found_404():
    db = FakeConfirmDb(order=None)
    with pytest.raises(HTTPException) as exc:
        order_service.confirm_order(db, 999)
    assert exc.value.status_code == 404


# ---------------------------------------------------------------------------
# list_orders
# ---------------------------------------------------------------------------


class _OrderListQ:
    """Stub for ``db.query(Order)`` / ``db.query(OrderItem.order_id)``.

    Captures chained filter/options/order_by/offset/limit/distinct calls
    (all no-ops) and returns the stored order list from ``.all()`` /
    ``count()``. SQL-level filtering is not exercised — it's covered by
    the API integration tests in Task 5.
    """

    def __init__(self, orders):
        self._orders = list(orders)

    def filter(self, *args, **kwargs):
        return self

    def options(self, *args, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def offset(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def distinct(self):
        return self

    def count(self):
        return len(self._orders)

    def all(self):
        return list(self._orders)


class FakeListDb:
    """Dispatcher for list_orders' query shapes.

    * ``count(`` in expr -> publication schedule COUNT.
    * ``max(`` in expr   -> publication schedule MAX(publish_date).
    * otherwise          -> Order list query.
    """

    def __init__(
        self,
        orders=None,
        schedule_count: int = 0,
        schedule_latest: Optional[date] = None,
    ):
        self.orders = orders or []
        self.schedule_count = schedule_count
        self.schedule_latest = schedule_latest

    def query(self, *args):
        text = str(args[0]).lower() if args else ""
        if "count(" in text:
            return _ScalarQ(self.schedule_count)
        if "max(" in text:
            return _ScalarQ(self.schedule_latest)
        return _OrderListQ(self.orders)


def _make_listable_order(
    *,
    order_id=1,
    status=OrderStatus.active,
    payer_name="X",
    total_amount=Decimal("100"),
    items_data=None,
) -> Order:
    """Build an Order with items attached for list-row aggregation tests."""
    order = _seeded_order(
        status=status,
        order_id=order_id,
        payer_name=payer_name,
        total_amount=total_amount,
    )
    order.order_code = f"ORD-2026-{order_id:06d}"
    items = []
    for idx, d in enumerate(items_data or [], start=order_id * 100):
        item = OrderItem(
            order_id=order_id,
            fulfillment_type=d["fulfillment_type"],
            coverage_start_date=d.get("coverage_start_date"),
            coverage_end_date=d.get("coverage_end_date"),
            total_quantity=d.get("total_quantity", 1),
            expected_issues_at_creation=d.get("expected_issues_at_creation"),
        )
        item.id = idx
        items.append(item)
    order.items = items
    return order


def test_list_orders_returns_empty_when_no_orders():
    db = FakeListDb(orders=[])
    rows, total = order_service.list_orders(db)
    assert rows == []
    assert total == 0


def test_list_orders_aggregates_quantity_and_coverage_per_order():
    order = _make_listable_order(
        order_id=1,
        items_data=[
            {"fulfillment_type": FulfillmentType.subscription,
             "coverage_start_date": date(2026, 3, 1),
             "coverage_end_date": date(2026, 6, 30),
             "total_quantity": 2,
             "expected_issues_at_creation": 17},
            {"fulfillment_type": FulfillmentType.subscription,
             "coverage_start_date": date(2026, 5, 1),
             "coverage_end_date": date(2026, 12, 31),
             "total_quantity": 1,
             "expected_issues_at_creation": 35},
        ],
    )
    db = FakeListDb(
        orders=[order],
        schedule_count=17,  # both items "currently" expect the same count -> matches per-item baseline only for item 1
        schedule_latest=date(2026, 12, 31),
    )
    rows, total = order_service.list_orders(db)
    assert total == 1
    row = rows[0]
    assert row.total_quantity == 3
    # coverage range spans min(start) -> max(end)
    assert row.coverage_start_date == date(2026, 3, 1)
    assert row.coverage_end_date == date(2026, 12, 31)
    # both items contribute current_expected (17 + 17 = 34)
    assert row.expected_total == 34


def test_list_orders_has_drift_detected_when_current_diverges_from_baseline():
    order = _make_listable_order(
        order_id=1,
        items_data=[
            {"fulfillment_type": FulfillmentType.subscription,
             "coverage_start_date": date(2026, 3, 1),
             "coverage_end_date": date(2026, 12, 31),
             "expected_issues_at_creation": 43},
        ],
    )
    # schedule now returns 45 -> drift of +2
    db = FakeListDb(orders=[order], schedule_count=45, schedule_latest=date(2026, 12, 31))
    rows, _ = order_service.list_orders(db)
    assert rows[0].has_drift is True
    assert rows[0].expected_total == 45


def test_list_orders_has_drift_filter_true_excludes_non_drift():
    no_drift = _make_listable_order(
        order_id=1,
        items_data=[
            {"fulfillment_type": FulfillmentType.subscription,
             "coverage_start_date": date(2026, 3, 1),
             "coverage_end_date": date(2026, 12, 31),
             "expected_issues_at_creation": 43},
        ],
    )
    db = FakeListDb(orders=[no_drift], schedule_count=43, schedule_latest=date(2026, 12, 31))
    rows, total = order_service.list_orders(db, has_drift=True)
    # baseline 43 == current 43 -> no drift -> filtered out
    assert rows == []
    # total still reflects DB-level filter result (drift is post-filter)
    assert total == 1


def test_list_orders_has_drift_filter_false_excludes_drifting():
    drifting = _make_listable_order(
        order_id=1,
        items_data=[
            {"fulfillment_type": FulfillmentType.subscription,
             "coverage_start_date": date(2026, 3, 1),
             "coverage_end_date": date(2026, 12, 31),
             "expected_issues_at_creation": 40},
        ],
    )
    db = FakeListDb(orders=[drifting], schedule_count=43, schedule_latest=date(2026, 12, 31))
    rows, total = order_service.list_orders(db, has_drift=False)
    assert rows == []
    assert total == 1


def test_list_orders_expected_total_none_when_all_items_unknown():
    """Gift items return current_expected=None; aggregate should be None, not 0."""
    order = _make_listable_order(
        order_id=1,
        items_data=[
            {"fulfillment_type": FulfillmentType.gift, "total_quantity": 1},
            {"fulfillment_type": FulfillmentType.gift, "total_quantity": 1},
        ],
    )
    db = FakeListDb(orders=[order])
    rows, _ = order_service.list_orders(db)
    assert rows[0].expected_total is None
    assert rows[0].has_drift is False  # no comparison possible


def test_list_orders_no_baseline_no_drift_even_when_schedule_changes():
    """Drafts before confirm have expected_issues_at_creation=None.

    Without a baseline we cannot detect drift — has_drift should stay
    False so they don't pollute the drift list.
    """
    draft = _make_listable_order(
        order_id=1,
        status=OrderStatus.draft,
        items_data=[
            {"fulfillment_type": FulfillmentType.subscription,
             "coverage_start_date": date(2026, 3, 1),
             "coverage_end_date": date(2026, 12, 31),
             "expected_issues_at_creation": None},
        ],
    )
    db = FakeListDb(orders=[draft], schedule_count=43, schedule_latest=date(2026, 12, 31))
    rows, _ = order_service.list_orders(db)
    assert rows[0].has_drift is False
    assert rows[0].expected_total == 43


def test_list_orders_row_payload_has_v13_placeholder_synced_count_zero():
    order = _make_listable_order(
        order_id=1,
        items_data=[
            {"fulfillment_type": FulfillmentType.single_issue,
             "total_quantity": 1,
             "expected_issues_at_creation": 1},
        ],
    )
    db = FakeListDb(orders=[order])
    rows, _ = order_service.list_orders(db)
    assert rows[0].synced_count == 0  # V1.3 placeholder
