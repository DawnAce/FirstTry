# V1.3 Order Shipping Details Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build manual preview-and-apply sync from one active order to one issue's `shipping_details`.

**Architecture:** Add a focused backend sync service that computes order-scoped candidates, diffs them against linked `shipping_details`, and applies changes transactionally. Expose order-scoped preview/apply APIs, then wire the existing OrderDetail shipping tab to preview/confirm sync and expose source/status tags in ZTO-MF tables.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic v2, pytest, React, TypeScript, Ant Design, TanStack Query.

---

## File Structure

- Create `backend/app/services/order_shipping_sync_service.py`: order-to-shipping candidate calculation, diffing, conflict detection, and transactional apply.
- Modify `backend/app/schemas/order.py`: Pydantic response/request models for sync preview/apply.
- Modify `backend/app/api/orders.py`: add `GET /api/orders/{order_id}/shipping-sync/preview` and `POST /api/orders/{order_id}/shipping-sync/apply`.
- Modify `backend/app/schemas/shipping_detail.py`: expose order linkage and sync metadata.
- Modify `backend/app/api/shipping_details.py`: mark edited order-generated rows as `manually_modified` and include linkage fields in operation snapshots.
- Modify `backend/app/services/order_service.py`: compute real `synced_count` from `shipping_details`.
- Create `backend/tests/test_order_shipping_sync_service.py`: service-level behavior and edge cases.
- Modify `backend/tests/test_orders_api.py`: HTTP wiring for preview/apply.
- Modify `backend/tests/test_shipping_details.py`: manual edit flips sync status.
- Modify `frontend/src/api/orders.ts`: sync request/response types and API functions.
- Modify `frontend/src/api/shippingDetails.ts`: linkage metadata types.
- Modify `frontend/src/pages/OrderDetail.tsx`: replace placeholder shipping tab with issue selector, preview table, and apply button.
- Modify `frontend/src/pages/recipientShippingColumns.tsx`: add source and sync status columns.
- Modify `frontend/src/pages/Recipients.tsx`: no logic change beyond using updated columns/types unless TypeScript requires it.
- Update `docs/technical.md`, `docs/user-guide.md`, and `docs/requirements.md` after implementation.

---

### Task 1: Backend sync service tests

**Files:**
- Create: `backend/tests/test_order_shipping_sync_service.py`
- Read: `backend/app/models/shipping_detail.py`
- Read: `backend/app/models/fulfillment_allocation.py`
- Read: `backend/app/models/fulfillment_target.py`

- [ ] **Step 1: Write failing service tests**

Create `backend/tests/test_order_shipping_sync_service.py` with this content:

```python
from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    BillingType,
    DeliveryMethod,
    FulfillmentAllocation,
    FulfillmentTarget,
    FulfillmentType,
    Issue,
    IssueStatus,
    Order,
    OrderEvent,
    OrderEventType,
    OrderItem,
    OrderStatus,
    Publication,
    PublicationFormat,
    ShippingChannel,
    ShippingDetail,
    ShippingDetailSourceType,
    ShippingDetailSyncStatus,
    SubscriptionTerm,
)
from app.services.order_shipping_sync_service import (
    apply_order_shipping_sync,
    preview_order_shipping_sync,
)


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


def seed_issue(db, issue_number=2655, publish_date=date(2026, 6, 1), is_suspended=False):
    issue = Issue(
        issue_number=issue_number,
        publish_date=publish_date,
        status=IssueStatus.draft,
        is_suspended=is_suspended,
    )
    db.add(issue)
    db.commit()
    return issue


def seed_active_subscription_order(db, *, issue_from=2650, issue_until=None, channel=ShippingChannel.zto_outsource):
    order = Order(
        order_code="ORD-2026-000001",
        order_date=date(2026, 1, 1),
        payer_name="吴娟",
        payer_contact="13800000000",
        status=OrderStatus.active,
        source_platform="微信小程序",
        source_store="CBJ+",
        total_amount=195,
        paid_amount=195,
    )
    db.add(order)
    db.flush()
    item = OrderItem(
        order_id=order.id,
        publication=Publication.cbj,
        publication_format=PublicationFormat.paper,
        fulfillment_type=FulfillmentType.subscription,
        billing_type=BillingType.paid,
        subscription_term=SubscriptionTerm.half_year,
        delivery_method=DeliveryMethod.zto_mf,
        term_start_month="2026-01",
        coverage_start_date=date(2026, 1, 5),
        coverage_end_date=date(2026, 6, 29),
        total_quantity=1,
        unit_price=195,
        subtotal=195,
    )
    db.add(item)
    db.flush()
    allocation = FulfillmentAllocation(
        order_item_id=item.id,
        version_no=1,
        effective_from_issue=issue_from,
        effective_until_issue=issue_until,
    )
    db.add(allocation)
    db.flush()
    target = FulfillmentTarget(
        order_item_id=item.id,
        allocation_id=allocation.id,
        recipient_name="张三",
        recipient_phone="13900000000",
        recipient_address="北京市朝阳区测试路 1 号",
        quantity=1,
        shipping_channel=channel,
    )
    db.add(target)
    db.commit()
    return order, item, allocation, target


def test_preview_creates_candidate_for_active_subscription_order(db):
    seed_issue(db)
    order, item, _, target = seed_active_subscription_order(db)

    preview = preview_order_shipping_sync(db, order.id, 2655)

    assert preview.summary.candidates == 1
    assert preview.summary.to_create == 1
    assert preview.summary.conflicts == 0
    row = preview.items[0]
    assert row.action == "create"
    assert row.order_id == order.id
    assert row.order_item_id == item.id
    assert row.fulfillment_target_id == target.id
    assert row.name == "张三"
    assert row.quantity == 1


def test_apply_creates_shipping_detail_and_order_event(db):
    seed_issue(db)
    order, item, _, target = seed_active_subscription_order(db)

    result = apply_order_shipping_sync(db, order.id, 2655, operator_id=7)

    assert result.summary.to_create == 1
    detail = db.query(ShippingDetail).one()
    assert detail.issue_number == 2655
    assert detail.name == "张三"
    assert detail.order_id == order.id
    assert detail.order_item_id == item.id
    assert detail.fulfillment_target_id == target.id
    assert detail.source_type == ShippingDetailSourceType.order_generated
    assert detail.sync_status == ShippingDetailSyncStatus.synced
    event = db.query(OrderEvent).filter(OrderEvent.event_type == OrderEventType.synced_to_shipping).one()
    assert event.operator_id == 7
    assert event.payload_json["issue_number"] == 2655
    assert event.payload_json["created_count"] == 1


def test_apply_is_idempotent_and_updates_linked_synced_row(db):
    seed_issue(db)
    order, _, _, _ = seed_active_subscription_order(db)
    apply_order_shipping_sync(db, order.id, 2655, operator_id=7)
    db.query(FulfillmentTarget).one().recipient_phone = "13911111111"
    db.commit()

    result = apply_order_shipping_sync(db, order.id, 2655, operator_id=7)

    assert result.summary.to_update == 1
    assert db.query(ShippingDetail).count() == 1
    assert db.query(ShippingDetail).one().phone == "13911111111"


def test_manually_modified_order_generated_row_blocks_apply(db):
    seed_issue(db)
    order, _, _, _ = seed_active_subscription_order(db)
    apply_order_shipping_sync(db, order.id, 2655, operator_id=7)
    detail = db.query(ShippingDetail).one()
    detail.sync_status = ShippingDetailSyncStatus.manually_modified
    detail.phone = "manual"
    db.commit()

    preview = preview_order_shipping_sync(db, order.id, 2655)
    assert preview.summary.conflicts == 1
    assert preview.items[0].action == "conflict"

    with pytest.raises(HTTPException) as ctx:
        apply_order_shipping_sync(db, order.id, 2655, operator_id=7)
    assert ctx.value.status_code == 409


def test_suspended_issue_returns_empty_preview(db):
    seed_issue(db, is_suspended=True)
    order, _, _, _ = seed_active_subscription_order(db)

    preview = preview_order_shipping_sync(db, order.id, 2655)

    assert preview.summary.candidates == 0
    assert preview.summary.to_create == 0
    assert preview.message == "目标期号为休刊期，不生成发货明细"


def test_non_zto_target_is_skipped(db):
    seed_issue(db)
    order, _, _, _ = seed_active_subscription_order(db, channel=ShippingChannel.post_office)

    preview = preview_order_shipping_sync(db, order.id, 2655)

    assert preview.summary.candidates == 0
    assert preview.summary.skipped == 1
    assert preview.items[0].action == "skip"
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
cd backend; pytest tests\test_order_shipping_sync_service.py -q
```

Expected: import failure for `app.services.order_shipping_sync_service`.

- [ ] **Step 3: Commit failing tests**

```powershell
git add backend\tests\test_order_shipping_sync_service.py
git commit -m "test: add order shipping sync service coverage" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Backend schemas and sync service

**Files:**
- Modify: `backend/app/schemas/order.py`
- Create: `backend/app/services/order_shipping_sync_service.py`
- Test: `backend/tests/test_order_shipping_sync_service.py`

- [ ] **Step 1: Add sync schema models**

Append these models to `backend/app/schemas/order.py` after the existing order output models:

```python
class OrderShippingSyncApplyIn(BaseModel):
    issue_number: int


class OrderShippingSyncSummary(BaseModel):
    candidates: int = 0
    to_create: int = 0
    to_update: int = 0
    skipped: int = 0
    conflicts: int = 0


class OrderShippingSyncItem(BaseModel):
    action: str
    order_id: int
    order_item_id: int | None = None
    fulfillment_target_id: int | None = None
    shipping_detail_id: int | None = None
    name: str | None = None
    quantity: int | None = None
    reason: str | None = None
    diff: dict | None = None


class OrderShippingSyncPreview(BaseModel):
    order_id: int
    issue_number: int
    summary: OrderShippingSyncSummary
    items: list[OrderShippingSyncItem]
    message: str | None = None
```

- [ ] **Step 2: Implement the sync service**

Create `backend/app/services/order_shipping_sync_service.py` with this structure:

```python
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Iterable

from fastapi import HTTPException
from sqlalchemy.orm import Session, selectinload

from app.models import Issue, Order, OrderStatus, ShippingDetail
from app.models.fulfillment_target import FulfillmentTarget, ShippingChannel, TargetStatus
from app.models.order_event import OrderEventType
from app.models.order_item import FulfillmentType, OrderItem, OrderItemStatus, PublicationFormat
from app.models.shipping_detail import ShippingDetailSourceType, ShippingDetailSyncStatus
from app.schemas.order import (
    OrderShippingSyncItem,
    OrderShippingSyncPreview,
    OrderShippingSyncSummary,
)
from app.services.address_service import normalize_address
from app.services.order_event_logger import log_event


SYNC_FIELDS = (
    "sheet_name",
    "channel",
    "company",
    "transport",
    "frequency",
    "status",
    "name",
    "address",
    "phone",
    "quantity",
    "notes",
    "extra_info",
)


@dataclass(frozen=True)
class SyncCandidate:
    order: Order
    item: OrderItem
    target: FulfillmentTarget
    data: dict


def preview_order_shipping_sync(db: Session, order_id: int, issue_number: int) -> OrderShippingSyncPreview:
    issue = _get_issue(db, issue_number)
    if getattr(issue, "is_suspended", False):
        return OrderShippingSyncPreview(
            order_id=order_id,
            issue_number=issue_number,
            summary=OrderShippingSyncSummary(),
            items=[],
            message="目标期号为休刊期，不生成发货明细",
        )

    order = _get_order(db, order_id)
    candidates, skipped = _build_candidates(order, issue_number, issue.publish_date)
    items: list[OrderShippingSyncItem] = skipped[:]
    summary = OrderShippingSyncSummary(skipped=len(skipped))

    for candidate in candidates:
        summary.candidates += 1
        linked = _find_linked_detail(db, issue_number, candidate)
        if linked is None:
            possible_duplicate = _find_possible_manual_duplicate(db, issue_number, candidate)
            if possible_duplicate is not None:
                summary.conflicts += 1
                items.append(_preview_item("conflict", candidate, possible_duplicate, "存在疑似重复的手工发货明细"))
            else:
                summary.to_create += 1
                items.append(_preview_item("create", candidate, None, None))
            continue

        if linked.sync_status == ShippingDetailSyncStatus.manually_modified:
            summary.conflicts += 1
            items.append(_preview_item("conflict", candidate, linked, "订单生成行已被人工修改"))
            continue

        diff = _diff_detail(linked, candidate.data)
        if diff:
            summary.to_update += 1
            items.append(_preview_item("update", candidate, linked, None, diff))
        else:
            summary.skipped += 1
            items.append(_preview_item("skip", candidate, linked, "已同步，无字段变化"))

    return OrderShippingSyncPreview(
        order_id=order_id,
        issue_number=issue_number,
        summary=summary,
        items=items,
    )


def apply_order_shipping_sync(
    db: Session,
    order_id: int,
    issue_number: int,
    operator_id: int | None,
) -> OrderShippingSyncPreview:
    preview = preview_order_shipping_sync(db, order_id, issue_number)
    if preview.summary.conflicts:
        log_event(
            db,
            order_id=order_id,
            event_type=OrderEventType.shipping_sync_conflict,
            payload={
                "issue_number": issue_number,
                "conflict_count": preview.summary.conflicts,
                "target_ids": [
                    item.fulfillment_target_id
                    for item in preview.items
                    if item.action == "conflict" and item.fulfillment_target_id is not None
                ],
            },
            operator_id=operator_id,
        )
        db.commit()
        raise HTTPException(status_code=409, detail=preview.model_dump())

    issue = _get_issue(db, issue_number)
    order = _get_order(db, order_id)
    candidates, _ = _build_candidates(order, issue_number, issue.publish_date)
    created_count = 0
    updated_count = 0

    for candidate in candidates:
        linked = _find_linked_detail(db, issue_number, candidate)
        if linked is None:
            db.add(ShippingDetail(**candidate.data))
            created_count += 1
            continue
        diff = _diff_detail(linked, candidate.data)
        if diff:
            for field, value in candidate.data.items():
                if field in SYNC_FIELDS:
                    setattr(linked, field, value)
            linked.sync_status = ShippingDetailSyncStatus.synced
            updated_count += 1

    if created_count or updated_count:
        log_event(
            db,
            order_id=order_id,
            event_type=OrderEventType.synced_to_shipping,
            payload={
                "issue_number": issue_number,
                "created_count": created_count,
                "updated_count": updated_count,
            },
            operator_id=operator_id,
        )
    db.commit()
    return preview_order_shipping_sync(db, order_id, issue_number)
```

Then add the helper functions below that block:

```python
def _get_issue(db: Session, issue_number: int) -> Issue:
    issue = db.query(Issue).filter(Issue.issue_number == issue_number).first()
    if issue is None:
        raise HTTPException(status_code=404, detail=f"Issue {issue_number} not found")
    return issue


def _get_order(db: Session, order_id: int) -> Order:
    order = (
        db.query(Order)
        .options(
            selectinload(Order.items)
            .selectinload(OrderItem.allocations)
            .selectinload("targets"),
            selectinload(Order.items).selectinload(OrderItem.targets),
        )
        .filter(Order.id == order_id)
        .first()
    )
    if order is None:
        raise HTTPException(status_code=404, detail=f"order {order_id} not found")
    if order.status != OrderStatus.active:
        raise HTTPException(status_code=409, detail="only active orders can be synced to shipping details")
    return order


def _build_candidates(order: Order, issue_number: int, publish_date: date) -> tuple[list[SyncCandidate], list[OrderShippingSyncItem]]:
    candidates: list[SyncCandidate] = []
    skipped: list[OrderShippingSyncItem] = []
    for item in order.items:
        if item.status != OrderItemStatus.active:
            skipped.append(_skip_item(order.id, item.id, None, "订单明细已取消"))
            continue
        if item.publication_format != PublicationFormat.paper:
            skipped.append(_skip_item(order.id, item.id, None, "非纸刊明细不生成中通发货"))
            continue
        if not _item_applies_to_issue(item, issue_number, publish_date):
            continue
        allocation = _select_allocation(item.allocations, issue_number)
        if allocation is None:
            skipped.append(_skip_item(order.id, item.id, None, "当期没有生效的履约方案"))
            continue
        for target in allocation.targets:
            if target.status != TargetStatus.active:
                skipped.append(_skip_item(order.id, item.id, target.id, "履约目标非 active"))
                continue
            if target.shipping_channel != ShippingChannel.zto_outsource:
                skipped.append(_skip_item(order.id, item.id, target.id, "非中通外包目标"))
                continue
            if not _target_applies_to_issue(target, issue_number):
                continue
            if not target.recipient_name or not target.recipient_address:
                skipped.append(_skip_item(order.id, item.id, target.id, "收件人姓名或地址缺失"))
                continue
            candidates.append(SyncCandidate(order=order, item=item, target=target, data=_candidate_data(order, item, target, issue_number)))
    return candidates, skipped
```

Continue with exact helper implementations:

```python
def _item_applies_to_issue(item: OrderItem, issue_number: int, publish_date: date) -> bool:
    if item.fulfillment_type in {FulfillmentType.single_issue, FulfillmentType.makeup}:
        return item.issue_number == issue_number
    if item.coverage_start_date and publish_date < item.coverage_start_date:
        return False
    if item.coverage_end_date and publish_date > item.coverage_end_date:
        return False
    return True


def _target_applies_to_issue(target: FulfillmentTarget, issue_number: int) -> bool:
    if target.effective_from_issue is not None and issue_number < target.effective_from_issue:
        return False
    if target.effective_until_issue is not None and issue_number > target.effective_until_issue:
        return False
    return True


def _select_allocation(allocations: Iterable, issue_number: int):
    candidates = [
        alloc
        for alloc in allocations
        if (alloc.effective_from_issue is None or alloc.effective_from_issue <= issue_number)
        and (alloc.effective_until_issue is None or alloc.effective_until_issue >= issue_number)
    ]
    if not candidates:
        return None
    return sorted(candidates, key=lambda alloc: alloc.version_no, reverse=True)[0]


def _candidate_data(order: Order, item: OrderItem, target: FulfillmentTarget, issue_number: int) -> dict:
    parsed = normalize_address(target.recipient_address)
    notes = f"订单 {order.order_code or order.id}；明细 {item.id}；履约类型 {item.fulfillment_type.value}"
    if target.notes:
        notes = f"{notes}；目标备注：{target.notes}"
    return {
        "issue_number": issue_number,
        "sheet_name": "ZTO-MF",
        "channel": order.source_platform or "个人订阅",
        "company": order.source_store,
        "transport": "中通物流",
        "frequency": "周",
        "status": "正常",
        "name": target.recipient_name,
        "address": parsed["address"],
        "phone": target.recipient_phone,
        "quantity": target.quantity,
        "notes": notes,
        "extra_info": f"order_item_id={item.id}; fulfillment_target_id={target.id}",
        "order_id": order.id,
        "order_item_id": item.id,
        "fulfillment_target_id": target.id,
        "source_type": ShippingDetailSourceType.order_generated,
        "sync_status": ShippingDetailSyncStatus.synced,
    }


def _find_linked_detail(db: Session, issue_number: int, candidate: SyncCandidate) -> ShippingDetail | None:
    return (
        db.query(ShippingDetail)
        .filter(
            ShippingDetail.issue_number == issue_number,
            ShippingDetail.order_id == candidate.order.id,
            ShippingDetail.order_item_id == candidate.item.id,
            ShippingDetail.fulfillment_target_id == candidate.target.id,
        )
        .first()
    )


def _find_possible_manual_duplicate(db: Session, issue_number: int, candidate: SyncCandidate) -> ShippingDetail | None:
    return (
        db.query(ShippingDetail)
        .filter(
            ShippingDetail.issue_number == issue_number,
            ShippingDetail.order_id.is_(None),
            ShippingDetail.name == candidate.target.recipient_name,
            ShippingDetail.phone == candidate.target.recipient_phone,
        )
        .first()
    )


def _diff_detail(detail: ShippingDetail, data: dict) -> dict:
    diff = {}
    for field in SYNC_FIELDS:
        old = getattr(detail, field)
        new = data[field]
        if old != new:
            diff[field] = {"old": old, "new": new}
    return diff


def _preview_item(action: str, candidate: SyncCandidate, detail: ShippingDetail | None, reason: str | None, diff: dict | None = None) -> OrderShippingSyncItem:
    return OrderShippingSyncItem(
        action=action,
        order_id=candidate.order.id,
        order_item_id=candidate.item.id,
        fulfillment_target_id=candidate.target.id,
        shipping_detail_id=detail.id if detail else None,
        name=candidate.target.recipient_name,
        quantity=candidate.target.quantity,
        reason=reason,
        diff=diff,
    )


def _skip_item(order_id: int, item_id: int | None, target_id: int | None, reason: str) -> OrderShippingSyncItem:
    return OrderShippingSyncItem(
        action="skip",
        order_id=order_id,
        order_item_id=item_id,
        fulfillment_target_id=target_id,
        reason=reason,
    )
```

- [ ] **Step 3: Fix selectinload string if needed**

If SQLAlchemy rejects `selectinload("targets")`, replace the options block with explicit imports:

```python
from app.models.fulfillment_allocation import FulfillmentAllocation

selectinload(Order.items)
.selectinload(OrderItem.allocations)
.selectinload(FulfillmentAllocation.targets)
```

- [ ] **Step 4: Run service tests**

Run:

```powershell
cd backend; pytest tests\test_order_shipping_sync_service.py -q
```

Expected: all tests pass.

- [ ] **Step 5: Commit service implementation**

```powershell
git add backend\app\schemas\order.py backend\app\services\order_shipping_sync_service.py backend\tests\test_order_shipping_sync_service.py
git commit -m "feat: add order shipping sync service" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Backend API wiring and progress counts

**Files:**
- Modify: `backend/app/api/orders.py`
- Modify: `backend/app/services/order_service.py`
- Modify: `backend/tests/test_orders_api.py`

- [ ] **Step 1: Add failing API tests**

Append to `backend/tests/test_orders_api.py`:

```python
def test_preview_order_shipping_sync_returns_candidates(client):
    created = client.post("/api/orders", json=_make_create_payload()).json()
    client.post(f"/api/orders/{created['id']}/confirm")

    r = client.get(f"/api/orders/{created['id']}/shipping-sync/preview", params={"issue_number": 2625})

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["order_id"] == created["id"]
    assert body["issue_number"] == 2625
    assert body["summary"]["to_create"] == 2


def test_apply_order_shipping_sync_creates_rows_and_updates_progress(client):
    created = client.post("/api/orders", json=_make_create_payload()).json()
    client.post(f"/api/orders/{created['id']}/confirm")

    r = client.post(f"/api/orders/{created['id']}/shipping-sync/apply", json={"issue_number": 2625})

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["summary"]["to_create"] == 0
    detail = client.get(f"/api/orders/{created['id']}").json()
    assert detail["items"][0]["progress"]["synced_count"] == 2
```

- [ ] **Step 2: Run API tests to verify they fail**

Run:

```powershell
cd backend; pytest tests\test_orders_api.py::test_preview_order_shipping_sync_returns_candidates tests\test_orders_api.py::test_apply_order_shipping_sync_creates_rows_and_updates_progress -q
```

Expected: 404 for missing routes or synced_count still 0.

- [ ] **Step 3: Wire routes in orders API**

In `backend/app/api/orders.py`, import the schemas and service:

```python
from app.schemas.order import OrderShippingSyncApplyIn, OrderShippingSyncPreview
from app.services.order_shipping_sync_service import apply_order_shipping_sync, preview_order_shipping_sync
```

Add these route functions before `@router.get("/{order_id}")` so static subpaths do not conflict:

```python
@router.get("/{order_id}/shipping-sync/preview", response_model=OrderShippingSyncPreview)
def preview_shipping_sync(
    order_id: int,
    issue_number: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    return preview_order_shipping_sync(db, order_id, issue_number)


@router.post("/{order_id}/shipping-sync/apply", response_model=OrderShippingSyncPreview)
def apply_shipping_sync(
    order_id: int,
    data: OrderShippingSyncApplyIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return apply_order_shipping_sync(
        db,
        order_id=order_id,
        issue_number=data.issue_number,
        operator_id=user.id,
    )
```

- [ ] **Step 4: Update fulfillment progress**

In `backend/app/services/order_service.py`, import `ShippingDetail`:

```python
from app.models.shipping_detail import ShippingDetail
```

Replace the `synced_count=0` line in `compute_fulfillment_progress` with:

```python
synced_count = (
    db.query(ShippingDetail)
    .filter(
        ShippingDetail.order_item_id == order_item.id,
        ShippingDetail.order_id == order_item.order_id,
    )
    .count()
)
```

Then return:

```python
return FulfillmentProgress(
    expected_at_creation=expected_at_creation,
    current_expected=current_expected,
    drift=drift,
    synced_count=synced_count,
    skipped_count=0,
)
```

- [ ] **Step 5: Run API tests**

Run:

```powershell
cd backend; pytest tests\test_orders_api.py::test_preview_order_shipping_sync_returns_candidates tests\test_orders_api.py::test_apply_order_shipping_sync_creates_rows_and_updates_progress -q
```

Expected: both tests pass.

- [ ] **Step 6: Commit API wiring**

```powershell
git add backend\app\api\orders.py backend\app\services\order_service.py backend\tests\test_orders_api.py
git commit -m "feat: expose order shipping sync API" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: shipping_details metadata and manual-edit conflict tracking

**Files:**
- Modify: `backend/app/schemas/shipping_detail.py`
- Modify: `backend/app/api/shipping_details.py`
- Modify: `backend/tests/test_shipping_details.py`

- [ ] **Step 1: Add failing tests**

Append to `backend/tests/test_shipping_details.py`:

```python
from app.models.shipping_detail import ShippingDetailSourceType, ShippingDetailSyncStatus
from app.api.shipping_details import update_shipping_detail


class ShippingDetailOrderSyncMetadataTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)

    def test_output_schema_exposes_order_sync_metadata(self):
        for field in (
            "order_id",
            "order_item_id",
            "fulfillment_target_id",
            "source_type",
            "sync_status",
        ):
            self.assertIn(field, ShippingDetailOut.model_fields)

    def test_manual_edit_marks_order_generated_row_manually_modified(self):
        db = self.SessionLocal()
        detail = ShippingDetail(
            issue_number=2655,
            sheet_name="ZTO-MF",
            channel="个人订阅",
            name="张三",
            quantity=1,
            order_id=1,
            order_item_id=2,
            fulfillment_target_id=3,
            source_type=ShippingDetailSourceType.order_generated,
            sync_status=ShippingDetailSyncStatus.synced,
        )
        db.add(detail)
        db.commit()

        updated = update_shipping_detail(
            detail.id,
            ShippingDetailUpdate(phone="13900000000"),
            db=db,
            user=User(id=1, username="admin", role=UserRole.admin, password_hash="x"),
        )

        self.assertEqual(updated.sync_status, ShippingDetailSyncStatus.manually_modified)
        db.close()
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
cd backend; pytest tests\test_shipping_details.py -q
```

Expected: schema metadata fields missing or sync status remains `synced`.

- [ ] **Step 3: Expose metadata in schema**

In `backend/app/schemas/shipping_detail.py`, import enums:

```python
from app.models.shipping_detail import ShippingDetailSourceType, ShippingDetailSyncStatus
```

Add fields to `ShippingDetailOut` before `created_at`:

```python
    order_id: Optional[int]
    order_item_id: Optional[int]
    fulfillment_target_id: Optional[int]
    source_type: ShippingDetailSourceType
    sync_status: ShippingDetailSyncStatus
```

- [ ] **Step 4: Track metadata in snapshots**

In `backend/app/api/shipping_details.py`, extend `_TRACKED_FIELDS`:

```python
    "company", "shipped_at", "order_id", "order_item_id",
    "fulfillment_target_id", "source_type", "sync_status",
```

Import enums:

```python
from app.models.shipping_detail import ShippingDetail, ShippingDetailSourceType, ShippingDetailSyncStatus
```

- [ ] **Step 5: Mark manual edits**

In `update_shipping_detail`, after applying `update_data` and before `new_snapshot`, add:

```python
    if (
        detail.source_type == ShippingDetailSourceType.order_generated
        and update_data
        and any(field in _TRACKED_FIELDS for field in update_data)
    ):
        detail.sync_status = ShippingDetailSyncStatus.manually_modified
```

- [ ] **Step 6: Run shipping detail tests**

Run:

```powershell
cd backend; pytest tests\test_shipping_details.py -q
```

Expected: all tests pass.

- [ ] **Step 7: Commit metadata changes**

```powershell
git add backend\app\schemas\shipping_detail.py backend\app\api\shipping_details.py backend\tests\test_shipping_details.py
git commit -m "feat: track shipping detail sync metadata" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Frontend API types and order detail sync UI

**Files:**
- Modify: `frontend/src/api/orders.ts`
- Modify: `frontend/src/api/shippingDetails.ts`
- Modify: `frontend/src/pages/OrderDetail.tsx`

- [ ] **Step 1: Add API types**

In `frontend/src/api/orders.ts`, add these interfaces near existing output types:

```typescript
export interface OrderShippingSyncSummary {
  candidates: number;
  to_create: number;
  to_update: number;
  skipped: number;
  conflicts: number;
}

export type OrderShippingSyncAction = 'create' | 'update' | 'skip' | 'conflict';

export interface OrderShippingSyncItem {
  action: OrderShippingSyncAction;
  order_id: number;
  order_item_id: number | null;
  fulfillment_target_id: number | null;
  shipping_detail_id: number | null;
  name: string | null;
  quantity: number | null;
  reason: string | null;
  diff: Record<string, { old: unknown; new: unknown }> | null;
}

export interface OrderShippingSyncPreview {
  order_id: number;
  issue_number: number;
  summary: OrderShippingSyncSummary;
  items: OrderShippingSyncItem[];
  message: string | null;
}
```

Add API functions near order mutations:

```typescript
export const previewOrderShippingSync = (
  orderId: number,
  issueNumber: number,
): Promise<AxiosResponse<OrderShippingSyncPreview>> =>
  api.get<OrderShippingSyncPreview>(`/orders/${orderId}/shipping-sync/preview`, {
    params: { issue_number: issueNumber },
  });

export const applyOrderShippingSync = (
  orderId: number,
  issueNumber: number,
): Promise<AxiosResponse<OrderShippingSyncPreview>> =>
  api.post<OrderShippingSyncPreview>(`/orders/${orderId}/shipping-sync/apply`, {
    issue_number: issueNumber,
  });
```

- [ ] **Step 2: Extend shipping detail type**

In `frontend/src/api/shippingDetails.ts`, add:

```typescript
export type ShippingDetailSourceType = 'manual' | 'order_generated' | 'historical_import';
export type ShippingDetailSyncStatus = 'synced' | 'manually_modified' | 'orphaned';
```

Add fields to `ShippingDetail`:

```typescript
  order_id: number | null;
  order_item_id: number | null;
  fulfillment_target_id: number | null;
  source_type: ShippingDetailSourceType;
  sync_status: ShippingDetailSyncStatus;
```

- [ ] **Step 3: Replace OrderDetail shipping tab**

In `frontend/src/pages/OrderDetail.tsx`, import `Select` and `TableColumnsType` if not already present, and import the new API functions/types:

```typescript
import { applyOrderShippingSync, previewOrderShippingSync } from '../api/orders';
import type { OrderShippingSyncItem, OrderShippingSyncPreview } from '../api/orders';
import { getIssues } from '../api/issues';
import type { Issue } from '../api/issues';
```

Add state/query/mutation inside `OrderDetail`:

```typescript
  const [syncIssueNumber, setSyncIssueNumber] = useState<number | undefined>();
  const [syncPreview, setSyncPreview] = useState<OrderShippingSyncPreview | null>(null);

  const issuesQuery = useQuery({
    queryKey: ['issues', 'order-shipping-sync'],
    queryFn: async () => {
      const res = await getIssues(0, 100);
      return [...res.data].sort((a: Issue, b: Issue) => b.issue_number - a.issue_number);
    },
  });

  const previewSyncMutation = useMutation({
    mutationFn: async () => {
      if (syncIssueNumber == null) throw new Error('请选择期号');
      const res = await previewOrderShippingSync(order.id, syncIssueNumber);
      return res.data;
    },
    onSuccess: (data) => setSyncPreview(data),
    onError: () => message.error('预览同步失败'),
  });

  const applySyncMutation = useMutation({
    mutationFn: async () => {
      if (syncIssueNumber == null) throw new Error('请选择期号');
      const res = await applyOrderShippingSync(order.id, syncIssueNumber);
      return res.data;
    },
    onSuccess: (data) => {
      message.success('已同步到发货明细');
      setSyncPreview(data);
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.detail(order.id) });
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.events(order.id) });
      queryClient.invalidateQueries({ queryKey: ['shippingDetails'] });
      queryClient.invalidateQueries({ queryKey: ['shippingCompanies'] });
      queryClient.invalidateQueries({ queryKey: ['report'] });
    },
    onError: () => message.error('同步失败，请先处理冲突'),
  });
```

Replace the Empty placeholder in the shipping tab with:

```tsx
<ShippingSyncTab
  issues={issuesQuery.data ?? []}
  loadingIssues={issuesQuery.isLoading}
  selectedIssueNumber={syncIssueNumber}
  onIssueChange={(value) => {
    setSyncIssueNumber(value);
    setSyncPreview(null);
  }}
  preview={syncPreview}
  previewing={previewSyncMutation.isPending}
  applying={applySyncMutation.isPending}
  onPreview={() => previewSyncMutation.mutate()}
  onApply={() => applySyncMutation.mutate()}
/>
```

Add the component below helper section:

```tsx
function ShippingSyncTab({
  issues,
  loadingIssues,
  selectedIssueNumber,
  onIssueChange,
  preview,
  previewing,
  applying,
  onPreview,
  onApply,
}: {
  issues: Issue[];
  loadingIssues: boolean;
  selectedIssueNumber?: number;
  onIssueChange: (value: number) => void;
  preview: OrderShippingSyncPreview | null;
  previewing: boolean;
  applying: boolean;
  onPreview: () => void;
  onApply: () => void;
}) {
  const columns: TableColumnsType<OrderShippingSyncItem> = [
    {
      title: '动作',
      dataIndex: 'action',
      width: 90,
      render: (action: OrderShippingSyncItem['action']) => {
        const color = action === 'conflict' ? 'red' : action === 'create' ? 'green' : action === 'update' ? 'blue' : 'default';
        const label = action === 'conflict' ? '冲突' : action === 'create' ? '新增' : action === 'update' ? '更新' : '跳过';
        return <Tag color={color}>{label}</Tag>;
      },
    },
    { title: '收件人', dataIndex: 'name', width: 120, render: (v: string | null) => v ?? '-' },
    { title: '份数', dataIndex: 'quantity', width: 80, render: (v: number | null) => v ?? '-' },
    { title: '明细 ID', dataIndex: 'order_item_id', width: 90, render: (v: number | null) => v ?? '-' },
    { title: '目标 ID', dataIndex: 'fulfillment_target_id', width: 90, render: (v: number | null) => v ?? '-' },
    { title: '原因', dataIndex: 'reason', render: (v: string | null) => v ?? '-' },
  ];
  const hasConflicts = (preview?.summary.conflicts ?? 0) > 0;
  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="手动预览后同步"
        description="选择期号后先预览新增、更新、跳过和冲突清单；无冲突时再确认写入 shipping_details。"
      />
      <Space>
        <Select
          style={{ width: 220 }}
          loading={loadingIssues}
          placeholder="选择同步期号"
          value={selectedIssueNumber}
          onChange={onIssueChange}
          options={issues.map((issue) => ({
            value: issue.issue_number,
            label: `第${issue.issue_number}期 ${issue.publish_date}`,
          }))}
        />
        <Button disabled={selectedIssueNumber == null} loading={previewing} onClick={onPreview}>
          预览同步
        </Button>
        <Button
          type="primary"
          disabled={!preview || hasConflicts}
          loading={applying}
          onClick={onApply}
        >
          确认同步
        </Button>
      </Space>
      {preview && (
        <>
          {preview.message && <Alert type="warning" showIcon message={preview.message} />}
          <Row gutter={16}>
            <Col span={4}><Statistic title="候选" value={preview.summary.candidates} /></Col>
            <Col span={4}><Statistic title="新增" value={preview.summary.to_create} /></Col>
            <Col span={4}><Statistic title="更新" value={preview.summary.to_update} /></Col>
            <Col span={4}><Statistic title="跳过" value={preview.summary.skipped} /></Col>
            <Col span={4}><Statistic title="冲突" value={preview.summary.conflicts} valueStyle={{ color: hasConflicts ? '#cf1322' : undefined }} /></Col>
          </Row>
          {hasConflicts && <Alert type="error" showIcon message="存在冲突，请先处理人工修改或疑似重复的发货明细。" />}
          <Table
            rowKey={(row) => `${row.action}-${row.order_item_id ?? 'item'}-${row.fulfillment_target_id ?? 'target'}-${row.shipping_detail_id ?? 'new'}`}
            size="small"
            columns={columns}
            dataSource={preview.items}
            pagination={false}
          />
        </>
      )}
    </Space>
  );
}
```

- [ ] **Step 4: Run TypeScript check**

Run:

```powershell
cd frontend; npx tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 5: Commit frontend sync UI**

```powershell
git add frontend\src\api\orders.ts frontend\src\api\shippingDetails.ts frontend\src\pages\OrderDetail.tsx
git commit -m "feat: add order shipping sync UI" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: Shipping table source/status visibility

**Files:**
- Modify: `frontend/src/pages/recipientShippingColumns.tsx`
- Test: `frontend/src/pages/recipientShippingColumns.test.tsx`

- [ ] **Step 1: Add or update column test**

In `frontend/src/pages/recipientShippingColumns.test.tsx`, add expectations:

```typescript
import { shippingDetailDisplayColumns } from './recipientShippingColumns';

it('includes source and sync status columns for order-generated rows', () => {
  const keys = shippingDetailDisplayColumns.map((column) => column.key);
  expect(keys).toContain('source_type');
  expect(keys).toContain('sync_status');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
cd frontend; npm test -- recipientShippingColumns --run
```

Expected: missing source/status columns.

- [ ] **Step 3: Add source/status columns**

In `frontend/src/pages/recipientShippingColumns.tsx`, add label maps:

```typescript
const sourceTypeLabels: Record<string, string> = {
  manual: '手工',
  order_generated: '订单生成',
  historical_import: '历史导入',
};

const syncStatusLabels: Record<string, string> = {
  synced: '已同步',
  manually_modified: '人工修改',
  orphaned: '孤立',
};
```

Insert columns after `签约公司`:

```tsx
  {
    title: '来源',
    dataIndex: 'source_type',
    key: 'source_type',
    width: 90,
    render: (v: string | null) => <Tag color={v === 'order_generated' ? 'blue' : 'default'}>{sourceTypeLabels[v ?? 'manual'] ?? v ?? '-'}</Tag>,
  },
  {
    title: '同步状态',
    dataIndex: 'sync_status',
    key: 'sync_status',
    width: 100,
    render: (v: string | null) => {
      const color = v === 'manually_modified' ? 'orange' : v === 'orphaned' ? 'red' : 'green';
      return <Tag color={color}>{syncStatusLabels[v ?? 'synced'] ?? v ?? '-'}</Tag>;
    },
  },
```

- [ ] **Step 4: Run frontend tests and typecheck**

Run:

```powershell
cd frontend; npm test -- recipientShippingColumns --run; npx tsc --noEmit
```

Expected: tests and typecheck pass.

- [ ] **Step 5: Commit table visibility**

```powershell
git add frontend\src\pages\recipientShippingColumns.tsx frontend\src\pages\recipientShippingColumns.test.tsx
git commit -m "feat: show shipping sync status in ZTO table" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 7: Documentation and final verification

**Files:**
- Modify: `docs/technical.md`
- Modify: `docs/user-guide.md`
- Modify: `docs/requirements.md`
- Test: backend and frontend verification commands

- [ ] **Step 1: Update technical docs**

In `docs/technical.md`, add a V1.3 subsection under order API docs:

```markdown
#### GET /api/orders/{order_id}/shipping-sync/preview
按单个 active 订单和目标期号预览会写入 `shipping_details` 的新增、更新、跳过和冲突清单，不修改数据。

#### POST /api/orders/{order_id}/shipping-sync/apply
按预览结果把无冲突的订单履约目标写入 `shipping_details`。订单生成行使用 `source_type=order_generated`、`sync_status=synced`，幂等键为 `order_id + order_item_id + fulfillment_target_id + issue_number`。如果存在人工修改或疑似重复，返回 409，不写入部分数据。
```

- [ ] **Step 2: Update user guide**

In `docs/user-guide.md`, replace the shipping sync placeholder text with:

```markdown
### 4.5 如何同步订单到发货明细

1. 进入订单详情页，打开「关联快递明细」Tab。
2. 选择目标期号，点击「预览同步」。
3. 核对新增、更新、跳过和冲突清单。
4. 如果没有冲突，点击「确认同步」写入 ZTO-MF 发货明细。
5. 返回「物流管理 → ZTO-MF」查看来源为「订单生成」的发货记录。

如果系统提示冲突，先到发货明细页处理人工修改或重复记录，再重新预览。
```

- [ ] **Step 3: Update requirements**

In `docs/requirements.md`, change the V1.3 priority row from pending wording to implemented wording after code lands:

```markdown
| 1 | 与 `shipping_details` 实际同步 | V1.3 已支持单订单按期号手动预览后同步，写入 `order_generated` 发货明细并记录 `synced_to_shipping` / `shipping_sync_conflict` 事件 |
```

- [ ] **Step 4: Run backend verification**

Run:

```powershell
cd backend; pytest tests\test_order_shipping_sync_service.py tests\test_orders_api.py tests\test_shipping_details.py -q
```

Expected: all selected backend tests pass.

- [ ] **Step 5: Run frontend verification**

Run:

```powershell
cd frontend; npx tsc --noEmit
```

Expected: typecheck passes.

- [ ] **Step 6: Commit docs and verification follow-ups**

```powershell
git add docs\technical.md docs\user-guide.md docs\requirements.md
git commit -m "docs: document V1.3 shipping sync" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

- [ ] **Step 7: Final status check**

Run:

```powershell
git --no-pager status --short --branch
git --no-pager log --oneline --decorate -8
```

Expected: branch is ahead by the task commits and has no unstaged changes.

---

## Self-Review

- Spec coverage: covered manual preview/apply, order-scoped endpoints, candidate rules, data mapping, conflict behavior, manual edit tracking, frontend OrderDetail entry, ZTO-MF visibility, and docs.
- Placeholder scan: no deferred implementation instructions; every code-changing step includes concrete snippets and exact commands.
- Type consistency: sync response types are named `OrderShippingSyncPreview`, `OrderShippingSyncSummary`, and `OrderShippingSyncItem` consistently across backend and frontend.

