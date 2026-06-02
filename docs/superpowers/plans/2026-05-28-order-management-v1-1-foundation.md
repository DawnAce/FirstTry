# Order Management V1.1 Foundation Implementation Plan

> **✅ 已交付 / Status: Delivered** — 2026-05-28 完成 Task 1 ~ Task 10 全部 10 个 Tasks，提交范围 `56bce63..24e3dc1`（14 个 commit，含 2 个设计文档 + 12 个 feat/docs 实现 commit）。
>
> - **后端**：73 个新单元/集成测试全部通过；全量 pytest 仅剩 8 个项目历史 baseline 失败，与本次改动无关。
> - **前端**：`npx tsc --noEmit` 0 错误；Vitest 58/58（含 31 个 orderUtils 测试）。
> - **文档**：README / docs/technical / docs/requirements / docs/user-guide 4 份均已同步。
> - **遗留**：本文件末尾「Manual smoke test」清单尚未在浏览器中跑过，待用户在开发环境中手工验证；履约方案多版本、active 状态明细编辑、与 `shipping_details` 同步等留待 V1.2 / V1.3。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the **Order Management V1.1 (Foundation)** stage of the simplified V1 MVP — users can manually create one order (with line items and one or more fulfillment targets), confirm it, browse the list, and view full detail with events. No batch import, no schedule version switching, no shipping sync (those are V1.2 and V1.3).

**Architecture:** Five new SQLAlchemy models (`orders`, `order_items`, `fulfillment_allocations`, `fulfillment_targets`, `order_events`) plus 5 nullable columns added to existing `shipping_details`. All 4 future-version fields (V2 hooks) are present from day one but unused. Backend exposes a `/api/orders` REST surface backed by an `order_service` that owns order_code generation, expected-issues estimation, and event logging. Frontend adds an "订单管理" menu group (currently disabled in `AppLayout.tsx`), three pages (list / editor / detail), and one API client module. V1.1 explicitly omits version-switching UI, sync button, and drift alerts.

**Tech Stack:** FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2, React, TypeScript, Ant Design 5, TanStack Query v5, Vitest. Existing MySQL-backed dev setup.

**Design Reference:** `docs/superpowers/specs/2026-05-28-order-management-v1-mvp-design.md`

**Scope of V1.1** (everything else is V1.2 / V1.3):

- ✅ Five new models + `shipping_details` column extension
- ✅ Single-form order creation with N line items × M fulfillment targets each
- ✅ Order draft → confirmed state transition (auto-creates v1 allocation, computes `expected_issues_at_creation`)
- ✅ Order list with filters (status, source, coverage period, payer name, drift)
- ✅ Order detail page with 4 tabs (drift tab read-only, sync tab placeholder, version tab read-only single version)
- ✅ Event stream recording (`created`, `confirmed`, `modified`, `voided`)
- ✅ Activate the "订单管理" menu group
- ✅ Documentation updates
- ❌ Version switching UI / new-allocation flow (V1.2)
- ❌ Per-target add/remove flow beyond order creation (V1.2)
- ❌ "Sync this issue" button (V1.3)
- ❌ Schedule-save drift alert modal (V1.3)
- ❌ Excel batch import / historical archive (V2)
- ❌ Shipping channel UI selector (V1.1 hardcodes `zto_outsource`)
- ❌ Publication selector UI (V1.1 hardcodes `cbj`)

---

## File Structure

Create or modify these files:

### Backend

- Create `backend/app/models/order.py`: `Order` model + status enum
- Create `backend/app/models/order_item.py`: `OrderItem` model + publication/fulfillment/billing enums
- Create `backend/app/models/fulfillment_allocation.py`: `FulfillmentAllocation` model
- Create `backend/app/models/fulfillment_target.py`: `FulfillmentTarget` model + shipping_channel/target_status enums
- Create `backend/app/models/order_event.py`: `OrderEvent` model + event_type enum
- Modify `backend/app/models/shipping_detail.py`: add 5 nullable columns (`order_id`, `order_item_id`, `fulfillment_target_id`, `source_type`, `sync_status`)
- Modify `backend/app/models/__init__.py`: export the 5 new models and enums
- Create `backend/alembic/versions/<rev>_add_order_management_v1_1.py`: migration for 5 new tables + `shipping_details` column additions
- Create `backend/app/schemas/order.py`: Pydantic schemas for create/update/out/list-row/detail/event
- Create `backend/app/services/order_service.py`: order CRUD, confirm, void, list with filters, detail composition, fulfillment progress computation
- Create `backend/app/services/order_code_service.py`: `generate_order_code(db, year)` → `ORD-YYYY-NNNNNN`
- Create `backend/app/services/expected_issues_calculator.py`: `compute_expected_issues(db, coverage_start, coverage_end, fulfillment_type)`
- Create `backend/app/services/order_event_logger.py`: `log_event(db, order_id, event_type, payload, operator_id)`
- Create `backend/app/api/orders.py`: REST endpoints under `/api/orders`
- Modify `backend/app/main.py`: register `orders_router` with auth dependency

### Backend Tests

- Create `backend/tests/test_order_code_service.py`
- Create `backend/tests/test_expected_issues_calculator.py`
- Create `backend/tests/test_order_service.py`
- Create `backend/tests/test_orders_api.py`

### Frontend

- Create `frontend/src/api/orders.ts`: typed API client + types
- Create `frontend/src/pages/OrderList.tsx`: list page with filters
- Create `frontend/src/pages/OrderEditor.tsx`: shared new/edit form
- Create `frontend/src/pages/OrderDetail.tsx`: detail page with 4 tabs
- Create `frontend/src/pages/orderUtils.ts`: source/payment enum labels, status badges, formatters
- Create `frontend/src/pages/orderUtils.test.ts`: Vitest tests for label helpers
- Modify `frontend/src/App.tsx`: add `/orders`, `/orders/new`, `/orders/:id`, `/orders/:id/edit` routes
- Modify `frontend/src/components/AppLayout.tsx`: activate "订单管理" menu group, add subnav items, update selected-key/open-keys logic

### Documentation

- Modify `README.md`: mention 订单管理 module (V1.1 scope only)
- Modify `docs/technical.md`: order management data model, API surface, expected-issues estimation
- Modify `docs/requirements.md`: V1.1 feature scope
- Modify `docs/user-guide.md`: single-order manual entry walkthrough

---

## Task 1: Backend data models + Alembic migration

**Files:**
- Create: `backend/app/models/order.py`, `order_item.py`, `fulfillment_allocation.py`, `fulfillment_target.py`, `order_event.py`
- Modify: `backend/app/models/shipping_detail.py`, `backend/app/models/__init__.py`
- Create: `backend/alembic/versions/<rev>_add_order_management_v1_1.py`

- [ ] **Step 1: Create `Order` model**

Create `backend/app/models/order.py` with:

```python
import enum
from sqlalchemy import Column, Integer, String, Text, Date, DateTime, Boolean, Numeric, Enum as SAEnum, ForeignKey, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class OrderSourceType(str, enum.Enum):
    ecommerce = "ecommerce"
    corporate_transfer = "corporate_transfer"
    vip_gift = "vip_gift"
    manual = "manual"
    mail_annual = "mail_annual"


class OrderPaymentMethod(str, enum.Enum):
    wechat = "wechat"
    alipay = "alipay"
    bank_card = "bank_card"
    corporate_transfer = "corporate_transfer"
    cash = "cash"
    offset = "offset"
    other = "other"


class OrderStatus(str, enum.Enum):
    draft = "draft"
    pending_confirmation = "pending_confirmation"
    active = "active"
    void = "void"


class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_code = Column(String(64), unique=True, nullable=True, index=True)
    external_order_no = Column(String(128), nullable=True, index=True)
    order_date = Column(Date, nullable=False)
    source_type = Column(SAEnum(OrderSourceType), nullable=False)
    source_platform = Column(String(64), nullable=True)
    source_store = Column(String(128), nullable=True)
    payer_name = Column(String(128), nullable=False)
    payer_contact = Column(String(64), nullable=True)
    payment_method = Column(SAEnum(OrderPaymentMethod), nullable=True)
    payment_collector = Column(String(64), nullable=True)
    total_amount = Column(Numeric(10, 2), default=0, nullable=False)
    paid_amount = Column(Numeric(10, 2), default=0, nullable=False)
    invoice_required = Column(Boolean, default=False, nullable=False)
    invoice_title = Column(Text, nullable=True)
    status = Column(SAEnum(OrderStatus), default=OrderStatus.draft, nullable=False, index=True)
    notes = Column(Text, nullable=True)
    # V2 hooks (V1.1 always NULL)
    import_batch_id = Column(Integer, nullable=True)
    import_row_no = Column(Integer, nullable=True)
    import_source_sheet = Column(String(64), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    items = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")
    events = relationship("OrderEvent", back_populates="order", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_orders_source_status_date", "source_type", "status", "order_date"),
        Index("ix_orders_payer", "payer_name"),
    )
```

- [ ] **Step 2: Create `OrderItem` model**

Create `backend/app/models/order_item.py`:

```python
import enum
from sqlalchemy import Column, Integer, String, Text, Date, DateTime, Numeric, Enum as SAEnum, ForeignKey, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class Publication(str, enum.Enum):
    cbj = "cbj"
    business_school = "business_school"
    other = "other"


class PublicationFormat(str, enum.Enum):
    paper = "paper"
    digital = "digital"


class FulfillmentType(str, enum.Enum):
    subscription = "subscription"
    single_issue = "single_issue"
    gift = "gift"
    makeup = "makeup"
    extension = "extension"          # V2
    replacement = "replacement"      # V2


class BillingType(str, enum.Enum):
    paid = "paid"
    free_gift = "free_gift"
    bundle_gift = "bundle_gift"


class OrderItemStatus(str, enum.Enum):
    active = "active"
    cancelled = "cancelled"


class OrderItem(Base):
    __tablename__ = "order_items"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(Integer, ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True)
    publication = Column(SAEnum(Publication), nullable=False, default=Publication.cbj)
    publication_format = Column(SAEnum(PublicationFormat), nullable=False, default=PublicationFormat.paper)
    fulfillment_type = Column(SAEnum(FulfillmentType), nullable=False)
    billing_type = Column(SAEnum(BillingType), nullable=False, default=BillingType.paid)
    coverage_start_date = Column(Date, nullable=True)
    coverage_end_date = Column(Date, nullable=True)
    issue_number = Column(Integer, nullable=True)
    total_quantity = Column(Integer, default=1, nullable=False)
    unit_price = Column(Numeric(10, 2), default=0, nullable=False)
    subtotal = Column(Numeric(10, 2), default=0, nullable=False)
    expected_issues_at_creation = Column(Integer, nullable=True)
    status = Column(SAEnum(OrderItemStatus), default=OrderItemStatus.active, nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    order = relationship("Order", back_populates="items")
    allocations = relationship("FulfillmentAllocation", back_populates="order_item", cascade="all, delete-orphan")
    targets = relationship("FulfillmentTarget", back_populates="order_item", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_order_items_publication_type_status", "publication", "fulfillment_type", "status"),
        Index("ix_order_items_coverage", "coverage_start_date", "coverage_end_date"),
    )
```

- [ ] **Step 3: Create `FulfillmentAllocation` model**

Create `backend/app/models/fulfillment_allocation.py`:

```python
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class FulfillmentAllocation(Base):
    __tablename__ = "fulfillment_allocations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_item_id = Column(Integer, ForeignKey("order_items.id", ondelete="CASCADE"), nullable=False, index=True)
    version_no = Column(Integer, nullable=False)
    effective_from_issue = Column(Integer, nullable=True)
    effective_until_issue = Column(Integer, nullable=True)
    change_reason = Column(String(255), nullable=True)
    operator_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    order_item = relationship("OrderItem", back_populates="allocations")
    targets = relationship("FulfillmentTarget", back_populates="allocation")

    __table_args__ = (
        UniqueConstraint("order_item_id", "version_no", name="uq_allocation_item_version"),
    )
```

- [ ] **Step 4: Create `FulfillmentTarget` model**

Create `backend/app/models/fulfillment_target.py`:

```python
import enum
from sqlalchemy import Column, Integer, String, Text, DateTime, Enum as SAEnum, ForeignKey, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class ShippingChannel(str, enum.Enum):
    zto_outsource = "zto_outsource"
    post_office = "post_office"   # V2
    self_sf = "self_sf"           # V2
    other = "other"               # V2


class TargetStatus(str, enum.Enum):
    active = "active"
    suspended = "suspended"
    replaced = "replaced"


class FulfillmentTarget(Base):
    __tablename__ = "fulfillment_targets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_item_id = Column(Integer, ForeignKey("order_items.id", ondelete="CASCADE"), nullable=False, index=True)
    allocation_id = Column(Integer, ForeignKey("fulfillment_allocations.id", ondelete="CASCADE"), nullable=False, index=True)
    recipient_name = Column(String(128), nullable=False)
    recipient_phone = Column(String(64), nullable=True)
    recipient_address = Column(Text, nullable=False)
    recipient_postal_code = Column(String(20), nullable=True)
    quantity = Column(Integer, default=1, nullable=False)
    shipping_channel = Column(SAEnum(ShippingChannel), nullable=False, default=ShippingChannel.zto_outsource)
    effective_from_issue = Column(Integer, nullable=True)
    effective_until_issue = Column(Integer, nullable=True)
    status = Column(SAEnum(TargetStatus), default=TargetStatus.active, nullable=False)
    replaced_by_target_id = Column(Integer, ForeignKey("fulfillment_targets.id"), nullable=True)  # V2 hook
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    order_item = relationship("OrderItem", back_populates="targets")
    allocation = relationship("FulfillmentAllocation", back_populates="targets")

    __table_args__ = (
        Index("ix_targets_eff_status", "effective_from_issue", "effective_until_issue", "status"),
    )
```

- [ ] **Step 5: Create `OrderEvent` model**

Create `backend/app/models/order_event.py`:

```python
import enum
from sqlalchemy import Column, Integer, Text, DateTime, Enum as SAEnum, ForeignKey, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class OrderEventType(str, enum.Enum):
    created = "created"
    imported = "imported"               # V2
    confirmed = "confirmed"
    modified = "modified"
    split = "split"
    voided = "voided"
    allocation_updated = "allocation_updated"
    target_added = "target_added"
    target_replaced = "target_replaced"
    target_suspended = "target_suspended"
    synced_to_shipping = "synced_to_shipping"        # V1.3
    shipping_sync_conflict = "shipping_sync_conflict"  # V1.3


class OrderEvent(Base):
    __tablename__ = "order_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(Integer, ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True)
    event_type = Column(SAEnum(OrderEventType), nullable=False, index=True)
    payload_json = Column(JSON, nullable=True)
    operator_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False, index=True)

    order = relationship("Order", back_populates="events")
```

- [ ] **Step 6: Extend `shipping_details` model**

Modify `backend/app/models/shipping_detail.py` — add 5 new columns and matching enums:

```python
# Add at top of file:
import enum
from sqlalchemy import Enum as SAEnum, ForeignKey


class ShippingDetailSourceType(str, enum.Enum):
    manual = "manual"
    order_generated = "order_generated"
    historical_import = "historical_import"


class ShippingDetailSyncStatus(str, enum.Enum):
    synced = "synced"
    manually_modified = "manually_modified"
    orphaned = "orphaned"
```

Add these 5 columns to the `ShippingDetail` class (after the existing columns, before timestamps):

```python
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=True, index=True)
    order_item_id = Column(Integer, ForeignKey("order_items.id"), nullable=True)
    fulfillment_target_id = Column(Integer, ForeignKey("fulfillment_targets.id"), nullable=True)
    source_type = Column(SAEnum(ShippingDetailSourceType), default=ShippingDetailSourceType.manual, nullable=False, index=True, server_default="manual")
    sync_status = Column(SAEnum(ShippingDetailSyncStatus), default=ShippingDetailSyncStatus.synced, nullable=False, server_default="synced")
```

- [ ] **Step 7: Export from `models/__init__.py`**

Modify `backend/app/models/__init__.py` to import and export:

- `Order, OrderSourceType, OrderPaymentMethod, OrderStatus`
- `OrderItem, Publication, PublicationFormat, FulfillmentType, BillingType, OrderItemStatus`
- `FulfillmentAllocation`
- `FulfillmentTarget, ShippingChannel, TargetStatus`
- `OrderEvent, OrderEventType`
- Add `ShippingDetailSourceType, ShippingDetailSyncStatus` to existing shipping_detail imports

Add all symbols to `__all__`.

- [ ] **Step 8: Write Alembic migration**

Find the most recent migration revision in `backend/alembic/versions/` (the one with no down-revisions pointing to it). Use it as `down_revision`. Generate a new file `<random_rev>_add_order_management_v1_1.py`.

The migration must:

1. Create table `orders` with all columns and indexes from Step 1.
2. Create table `order_items` with all columns and indexes from Step 2.
3. Create table `fulfillment_allocations` with all columns and unique constraint from Step 3.
4. Create table `fulfillment_targets` with all columns and indexes from Step 4.
5. Create table `order_events` with all columns from Step 5.
6. Add 5 columns to `shipping_details` with `server_default` for the two enum columns so existing rows get valid values.

Add corresponding `downgrade()` that drops everything in reverse order.

Use SQLAlchemy enum names matching the Python enum class names (e.g., `orderstatus`, `publication`, `shippingchannel`).

- [ ] **Step 9: Run migration locally**

```bash
cd backend
source venv/Scripts/activate
alembic upgrade head
```

Verify tables exist via `\d orders` or equivalent MySQL `DESCRIBE orders;`.

## Task 2: Backend utility services

**Files:**
- Create: `backend/app/services/order_code_service.py`
- Create: `backend/app/services/expected_issues_calculator.py`
- Create: `backend/app/services/order_event_logger.py`
- Create: `backend/tests/test_order_code_service.py`
- Create: `backend/tests/test_expected_issues_calculator.py`

- [ ] **Step 1: Order code generator with tests**

Write `backend/tests/test_order_code_service.py` first:

```python
from datetime import date
from app.services.order_code_service import generate_order_code


def test_generates_padded_sequence(db_session, year_factory):
    code1 = generate_order_code(db_session, year=2026)
    code2 = generate_order_code(db_session, year=2026)
    assert code1 == "ORD-2026-000001"
    assert code2 == "ORD-2026-000002"


def test_year_isolation(db_session):
    c25 = generate_order_code(db_session, year=2025)
    c26 = generate_order_code(db_session, year=2026)
    assert c25.startswith("ORD-2025-")
    assert c26.startswith("ORD-2026-")
```

Then implement `backend/app/services/order_code_service.py`:

- Counts existing `Order` rows where `order_code LIKE 'ORD-{year}-%'`
- Returns next sequence in format `ORD-YYYY-NNNNNN` (6-digit zero-padded)
- Caller is responsible for inserting; this just returns the next code (no concurrent-safety lock for V1.1 since order volume is low — note that in docstring)

- [ ] **Step 2: Expected issues calculator with tests**

Write `backend/tests/test_expected_issues_calculator.py` first:

```python
from datetime import date
from app.services.expected_issues_calculator import compute_expected_issues
from app.models import PublicationSchedule, FulfillmentType


def test_subscription_within_schedule(db_session, seed_2026_schedule):
    # Coverage entirely inside known schedule
    n = compute_expected_issues(
        db_session,
        coverage_start=date(2026, 3, 1),
        coverage_end=date(2026, 12, 31),
        fulfillment_type=FulfillmentType.subscription,
    )
    # 2026-03-01 ~ 2026-12-31, minus suspended weeks
    assert n > 0
    assert n < 50  # less than full year


def test_subscription_crosses_year_with_estimation(db_session, seed_2026_schedule):
    n = compute_expected_issues(
        db_session,
        coverage_start=date(2026, 3, 1),
        coverage_end=date(2027, 2, 28),
        fulfillment_type=FulfillmentType.subscription,
    )
    # known 2026 part + estimated 2027 part
    assert n > 40


def test_single_issue_returns_one(db_session):
    n = compute_expected_issues(
        db_session,
        coverage_start=None,
        coverage_end=None,
        fulfillment_type=FulfillmentType.single_issue,
    )
    assert n == 1


def test_gift_makeup_return_none(db_session):
    assert compute_expected_issues(
        db_session, None, None, FulfillmentType.gift
    ) is None
```

Then implement `backend/app/services/expected_issues_calculator.py`:

```python
from datetime import date, timedelta
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.models import PublicationSchedule
from app.models.order_item import FulfillmentType


def compute_expected_issues(
    db: Session,
    coverage_start: Optional[date],
    coverage_end: Optional[date],
    fulfillment_type: FulfillmentType,
) -> Optional[int]:
    """
    Returns expected number of issues for the given coverage period.
    - subscription: COUNT(schedule WHERE publish_date in range AND issue_number IS NOT NULL)
                    + estimated weeks for portion beyond known schedule
    - single_issue: 1
    - gift / makeup / extension / replacement: None (not auto-synced)
    """
    if fulfillment_type == FulfillmentType.single_issue:
        return 1
    if fulfillment_type != FulfillmentType.subscription:
        return None
    if coverage_start is None or coverage_end is None:
        return None

    # Known issues
    known = (
        db.query(func.count(PublicationSchedule.id))
        .filter(
            PublicationSchedule.publish_date >= coverage_start,
            PublicationSchedule.publish_date <= coverage_end,
            PublicationSchedule.issue_number.isnot(None),
        )
        .scalar()
    ) or 0

    # If coverage extends beyond the latest known publish_date, estimate
    latest = (
        db.query(func.max(PublicationSchedule.publish_date))
        .filter(PublicationSchedule.publish_date <= coverage_end)
        .scalar()
    )
    if latest and latest < coverage_end:
        # Estimate ~1 issue per 7 days minus ~2% holiday assumption
        days_remaining = (coverage_end - latest).days
        estimated = max(0, days_remaining // 7)
        return known + estimated

    return known
```

- [ ] **Step 3: Event logger (no tests — trivial helper)**

Create `backend/app/services/order_event_logger.py`:

```python
from typing import Optional
from sqlalchemy.orm import Session
from app.models import OrderEvent, OrderEventType


def log_event(
    db: Session,
    order_id: int,
    event_type: OrderEventType,
    payload: Optional[dict] = None,
    operator_id: Optional[int] = None,
) -> OrderEvent:
    """Append an order_events row. Does NOT commit — caller controls transaction."""
    event = OrderEvent(
        order_id=order_id,
        event_type=event_type,
        payload_json=payload,
        operator_id=operator_id,
    )
    db.add(event)
    db.flush()
    return event
```

## Task 3: Pydantic schemas

**Files:**
- Create: `backend/app/schemas/order.py`

- [ ] **Step 1: Define order, item, allocation, target, event schemas**

Create `backend/app/schemas/order.py`:

```python
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional
from pydantic import BaseModel, Field
from app.models.order import OrderSourceType, OrderPaymentMethod, OrderStatus
from app.models.order_item import (
    Publication, PublicationFormat, FulfillmentType, BillingType, OrderItemStatus,
)
from app.models.fulfillment_target import ShippingChannel, TargetStatus
from app.models.order_event import OrderEventType


# --- Inputs ---

class FulfillmentTargetIn(BaseModel):
    recipient_name: str
    recipient_phone: Optional[str] = None
    recipient_address: str
    recipient_postal_code: Optional[str] = None
    quantity: int = 1
    shipping_channel: ShippingChannel = ShippingChannel.zto_outsource
    effective_from_issue: Optional[int] = None
    effective_until_issue: Optional[int] = None
    notes: Optional[str] = None


class OrderItemIn(BaseModel):
    publication: Publication = Publication.cbj
    publication_format: PublicationFormat = PublicationFormat.paper
    fulfillment_type: FulfillmentType
    billing_type: BillingType = BillingType.paid
    coverage_start_date: Optional[date] = None
    coverage_end_date: Optional[date] = None
    issue_number: Optional[int] = None
    total_quantity: int = 1
    unit_price: Decimal = Decimal("0")
    subtotal: Decimal = Decimal("0")
    notes: Optional[str] = None
    targets: List[FulfillmentTargetIn] = Field(default_factory=list)


class OrderCreate(BaseModel):
    external_order_no: Optional[str] = None
    order_date: date
    source_type: OrderSourceType
    source_platform: Optional[str] = None
    source_store: Optional[str] = None
    payer_name: str
    payer_contact: Optional[str] = None
    payment_method: Optional[OrderPaymentMethod] = None
    payment_collector: Optional[str] = None
    total_amount: Decimal = Decimal("0")
    paid_amount: Decimal = Decimal("0")
    invoice_required: bool = False
    invoice_title: Optional[str] = None
    notes: Optional[str] = None
    items: List[OrderItemIn] = Field(min_length=1)


class OrderUpdate(BaseModel):
    """For editing a draft / pending order. Cannot update active orders' core fields — only notes."""
    external_order_no: Optional[str] = None
    source_platform: Optional[str] = None
    source_store: Optional[str] = None
    payer_contact: Optional[str] = None
    payment_method: Optional[OrderPaymentMethod] = None
    payment_collector: Optional[str] = None
    total_amount: Optional[Decimal] = None
    paid_amount: Optional[Decimal] = None
    invoice_required: Optional[bool] = None
    invoice_title: Optional[str] = None
    notes: Optional[str] = None


# --- Outputs ---

class FulfillmentTargetOut(BaseModel):
    id: int
    recipient_name: str
    recipient_phone: Optional[str]
    recipient_address: str
    recipient_postal_code: Optional[str]
    quantity: int
    shipping_channel: ShippingChannel
    effective_from_issue: Optional[int]
    effective_until_issue: Optional[int]
    status: TargetStatus
    notes: Optional[str]
    model_config = {"from_attributes": True}


class FulfillmentAllocationOut(BaseModel):
    id: int
    version_no: int
    effective_from_issue: Optional[int]
    effective_until_issue: Optional[int]
    change_reason: Optional[str]
    created_at: datetime
    targets: List[FulfillmentTargetOut]
    model_config = {"from_attributes": True}


class FulfillmentProgress(BaseModel):
    expected_at_creation: Optional[int]
    current_expected: Optional[int]
    drift: Optional[int]
    synced_count: int
    skipped_count: int


class OrderItemOut(BaseModel):
    id: int
    publication: Publication
    publication_format: PublicationFormat
    fulfillment_type: FulfillmentType
    billing_type: BillingType
    coverage_start_date: Optional[date]
    coverage_end_date: Optional[date]
    issue_number: Optional[int]
    total_quantity: int
    unit_price: Decimal
    subtotal: Decimal
    expected_issues_at_creation: Optional[int]
    status: OrderItemStatus
    notes: Optional[str]
    allocations: List[FulfillmentAllocationOut]
    progress: FulfillmentProgress
    model_config = {"from_attributes": True}


class OrderEventOut(BaseModel):
    id: int
    event_type: OrderEventType
    payload_json: Optional[dict]
    operator_id: Optional[int]
    created_at: datetime
    model_config = {"from_attributes": True}


class OrderOut(BaseModel):
    id: int
    order_code: Optional[str]
    external_order_no: Optional[str]
    order_date: date
    source_type: OrderSourceType
    source_platform: Optional[str]
    source_store: Optional[str]
    payer_name: str
    payer_contact: Optional[str]
    payment_method: Optional[OrderPaymentMethod]
    payment_collector: Optional[str]
    total_amount: Decimal
    paid_amount: Decimal
    invoice_required: bool
    invoice_title: Optional[str]
    status: OrderStatus
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime
    items: List[OrderItemOut]
    model_config = {"from_attributes": True}


class OrderListRow(BaseModel):
    id: int
    order_code: Optional[str]
    external_order_no: Optional[str]
    order_date: date
    payer_name: str
    source_type: OrderSourceType
    source_platform: Optional[str]
    total_quantity: int
    total_amount: Decimal
    coverage_start_date: Optional[date]
    coverage_end_date: Optional[date]
    status: OrderStatus
    has_drift: bool
    synced_count: int
    expected_total: Optional[int]
```

## Task 4: Order service

**Files:**
- Create: `backend/app/services/order_service.py`
- Create: `backend/tests/test_order_service.py`

- [ ] **Step 1: Write order_service tests first**

`backend/tests/test_order_service.py` covers:

- `create_order_draft` creates `Order` with status=`draft`, items with allocations & targets nested, returns order with id
- `confirm_order` generates `order_code`, transitions to `active`, creates v1 allocation per item, attaches existing targets to v1, computes `expected_issues_at_creation` for subscription/single_issue items, logs `confirmed` event
- `void_order` transitions to `void`, logs `voided` event
- `list_orders` returns rows with filters (status, source_type, coverage range overlap, payer_name LIKE, has_drift)
- `get_order_detail` returns nested items+allocations+targets+progress
- `compute_fulfillment_progress` returns `expected_at_creation`, `current_expected`, `drift`, `synced_count=0` (V1.1 placeholder)

- [ ] **Step 2: Implement `order_service.py`**

Service functions:

```python
def create_order_draft(db, data: OrderCreate, created_by: int) -> Order:
    """Create order + items + targets. No v1 allocation yet. Status=draft. Log 'created' event."""

def confirm_order(db, order_id: int, operator_id: int) -> Order:
    """
    1. Generate order_code
    2. For each item:
       - Create FulfillmentAllocation(version_no=1, effective_from_issue=None, effective_until_issue=None)
       - Attach all existing targets to this allocation (set allocation_id)
       - Compute expected_issues_at_creation and save
    3. Set status=active
    4. Log 'confirmed' event
    """

def update_order(db, order_id: int, data: OrderUpdate, operator_id: int) -> Order:
    """Update editable fields. Log 'modified' event with diff in payload."""

def void_order(db, order_id: int, reason: str, operator_id: int) -> Order:
    """Set status=void. Log 'voided' event with reason."""

def list_orders(
    db,
    status: Optional[OrderStatus] = None,
    source_type: Optional[OrderSourceType] = None,
    payer_name_like: Optional[str] = None,
    coverage_start: Optional[date] = None,
    coverage_end: Optional[date] = None,
    has_drift: Optional[bool] = None,
    skip: int = 0,
    limit: int = 50,
) -> tuple[List[OrderListRow], int]:
    """Returns (rows, total_count). Computes has_drift per-order by aggregating items."""

def get_order_detail(db, order_id: int) -> Order:
    """Returns order with items, allocations, targets all preloaded."""

def compute_fulfillment_progress(db, order_item: OrderItem) -> FulfillmentProgress:
    """
    Returns:
      expected_at_creation = item.expected_issues_at_creation
      current_expected = compute_expected_issues(...)
      drift = current_expected - expected_at_creation (if both not None)
      synced_count = 0 (V1.1 placeholder; will read shipping_details count in V1.3)
      skipped_count = 0 (V1.3)
    """
```

Important rules:

- All mutations except `list_orders` and `get_order_detail` must call `log_event`.
- `confirm_order` must be idempotent — if already active, raise 409.
- `update_order` rejects edits to `order_date`, `source_type`, `payer_name`, `items` once status=active (only notes-like fields allowed). For active orders, structural edits require future V1.2 version-switching flow.

## Task 5: REST API endpoints

**Files:**
- Create: `backend/app/api/orders.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_orders_api.py`

- [ ] **Step 1: Write API integration tests first**

Cover happy-path and key error cases:

- `POST /api/orders` 201 returns OrderOut with status=draft
- `POST /api/orders/{id}/confirm` 200 transitions to active, returns OrderOut with order_code
- `POST /api/orders/{id}/confirm` already-active → 409
- `PUT /api/orders/{id}` updates editable fields
- `PUT /api/orders/{id}` on active order: only notes-like fields succeed; structural fields rejected with 422
- `POST /api/orders/{id}/void` 200 transitions to void
- `GET /api/orders` with filters returns OrderListRow
- `GET /api/orders/{id}` returns OrderOut with nested items+allocations+targets+progress
- `GET /api/orders/{id}/events` returns OrderEventOut list (descending by created_at)
- `GET /api/orders/{id}/fulfillment-progress` returns per-item progress array

- [ ] **Step 2: Implement endpoints**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date
from app.database import get_db
from app.auth import get_current_user
from app.models import User
from app.schemas.order import (
    OrderCreate, OrderUpdate, OrderOut, OrderListRow,
    OrderEventOut, FulfillmentProgress,
)
from app.services import order_service

router = APIRouter(prefix="/api/orders", tags=["orders"])


@router.get("", response_model=dict)
def list_orders(...): ...

@router.get("/{order_id}", response_model=OrderOut)
def get_order(order_id: int, ...): ...

@router.post("", response_model=OrderOut, status_code=201)
def create_order(data: OrderCreate, ...): ...

@router.put("/{order_id}", response_model=OrderOut)
def update_order(order_id: int, data: OrderUpdate, ...): ...

@router.post("/{order_id}/confirm", response_model=OrderOut)
def confirm_order(order_id: int, ...): ...

@router.post("/{order_id}/void", response_model=OrderOut)
def void_order(order_id: int, reason: str, ...): ...

@router.get("/{order_id}/events", response_model=List[OrderEventOut])
def list_events(order_id: int, ...): ...

@router.get("/{order_id}/fulfillment-progress", response_model=List[FulfillmentProgress])
def get_progress(order_id: int, ...): ...
```

The list endpoint returns `{"rows": [...], "total": N}` to support pagination metadata.

- [ ] **Step 3: Register router in `main.py`**

Add:

```python
from app.api.orders import router as orders_router
# ...
app.include_router(orders_router, dependencies=[Depends(get_current_user)])
```

## Task 6: Frontend API client

**Files:**
- Create: `frontend/src/api/orders.ts`

- [ ] **Step 1: Define types and client functions**

Mirror Pydantic schemas as TypeScript types. Use existing `client.ts` axios instance. Define:

```typescript
export type OrderStatus = 'draft' | 'pending_confirmation' | 'active' | 'void';
export type SourceType = 'ecommerce' | 'corporate_transfer' | 'vip_gift' | 'manual' | 'mail_annual';
export type FulfillmentType = 'subscription' | 'single_issue' | 'gift' | 'makeup' | 'extension' | 'replacement';
// ... all the other enums

export interface FulfillmentTargetIn { /* ... */ }
export interface OrderItemIn { /* ... */ }
export interface OrderCreatePayload { /* ... */ }
export interface OrderListRow { /* ... */ }
export interface OrderOut { /* ... */ }
// ...

export interface ListOrdersParams {
  status?: OrderStatus;
  sourceType?: SourceType;
  payerName?: string;
  coverageStart?: string;
  coverageEnd?: string;
  hasDrift?: boolean;
  skip?: number;
  limit?: number;
}

export async function listOrders(params: ListOrdersParams): Promise<{ rows: OrderListRow[]; total: number }>;
export async function getOrder(id: number): Promise<OrderOut>;
export async function createOrder(payload: OrderCreatePayload): Promise<OrderOut>;
export async function updateOrder(id: number, payload: OrderUpdatePayload): Promise<OrderOut>;
export async function confirmOrder(id: number): Promise<OrderOut>;
export async function voidOrder(id: number, reason: string): Promise<OrderOut>;
export async function listOrderEvents(id: number): Promise<OrderEventOut[]>;
```

## Task 7: Order list page

**Files:**
- Create: `frontend/src/pages/OrderList.tsx`
- Create: `frontend/src/pages/orderUtils.ts`
- Create: `frontend/src/pages/orderUtils.test.ts`

- [ ] **Step 1: Write orderUtils tests first**

Test label mappings for source_type, payment_method, status, fulfillment_type:

```typescript
import { describe, it, expect } from 'vitest';
import { sourceTypeLabel, statusLabel, statusBadgeColor, formatCoverage } from './orderUtils';

describe('sourceTypeLabel', () => {
  it('maps known enums', () => {
    expect(sourceTypeLabel('ecommerce')).toBe('电商');
    expect(sourceTypeLabel('corporate_transfer')).toBe('对公转账');
    expect(sourceTypeLabel('vip_gift')).toBe('VIP 赠阅');
  });
});

describe('statusBadgeColor', () => {
  it('returns ant design status names', () => {
    expect(statusBadgeColor('draft')).toBe('default');
    expect(statusBadgeColor('active')).toBe('success');
    expect(statusBadgeColor('void')).toBe('error');
  });
});

describe('formatCoverage', () => {
  it('formats start ~ end', () => {
    expect(formatCoverage('2026-03-01', '2026-12-31')).toBe('2026-03-01 ~ 2026-12-31');
  });
  it('handles null', () => {
    expect(formatCoverage(null, null)).toBe('-');
  });
});
```

- [ ] **Step 2: Implement orderUtils**

All label maps, badge color helpers, currency/date formatters.

- [ ] **Step 3: Build OrderList page**

Layout: Page header + filter form + Ant Table + "新建订单" button.

Use `useQuery({ queryKey: ['orders', filters], queryFn: () => listOrders(filters) })`.

Columns: 订单编码 / 来源单号 / 下单日期 / 付款主体 / 来源 / 份数 / 金额 / 覆盖期 / 状态 / 期数 (已同步/计划 含偏差标记) / 操作 (查看 / 作废).

Filters: 状态 / 来源类型 / 付款主体关键字 / 覆盖起 / 覆盖止 / 期数偏差 (全部 / 含偏差 / 无偏差).

Row click navigates to `/orders/:id`.

## Task 8: Order editor page (new + edit shared)

**Files:**
- Create: `frontend/src/pages/OrderEditor.tsx`

- [ ] **Step 1: Build single-page form**

Use Ant Design `Form` with sections:

1. **订单基本信息**: 下单日期、来源类型、来源平台、来源店铺、付款主体、付款联系人、支付方式、收款经办人、订单总金额、已付金额、是否开票、开票抬头、备注。
2. **订单明细 (Form.List)**: 每条明细折叠展开，包含 履约类型、覆盖起、覆盖止、单期期号 (仅 single_issue)、总份数、单价、小计、备注。
3. **每条明细下的履约目标 (嵌套 Form.List)**: 收件人姓名、电话、地址、邮编、份数、备注。
   - V1.1 不暴露 `shipping_channel` 选择 (后端默认 zto_outsource).
   - V1.1 不暴露 `publication` 选择 (后端默认 cbj).
   - V1.1 不暴露 target 的 effective_from / until (复杂场景留 V1.2).

Bottom action bar:

- 编辑模式 (id 存在): "保存草稿" + "确认生效" + "取消".
- 新建模式: 同上.

Validation:

- 至少 1 条明细
- 每条明细至少 1 个履约目标
- 明细 total_quantity 必须等于该明细下所有 target.quantity 之和 (前端校验)
- subscription / single_issue: coverage 必填
- gift / makeup: coverage 可空 (但 single_issue 仍要 issue_number)

On "确认生效": call `createOrder` (or `updateOrder` if editing) → then `confirmOrder` → invalidate `['orders']` cache → navigate to `/orders/:id`.

## Task 9: Order detail page

**Files:**
- Create: `frontend/src/pages/OrderDetail.tsx`

- [ ] **Step 1: Build 4-tab detail page**

Header: 订单编码、状态徽章、付款主体、覆盖期、总金额、操作按钮 (编辑 / 作废).

Tabs:

**Tab 1: 订单明细**
- 每条明细一张卡片，展示：履约类型、覆盖期、总份数、单价、小计。
- 明细下方表格展示履约目标：收件人、地址、份数、状态。
- 顶部小卡片展示该明细的履约进度：创建时预估 X / 当前预估 Y / 偏差 Z / 已同步 0 (V1.1 placeholder).

**Tab 2: 分配方案版本**
- 表格列出该订单所有明细的 allocation 版本（V1.1 仅 v1，但布局已为 V1.2 准备好）。
- 列：明细名 / 版本号 / 生效起 / 生效止 / 变更原因 / 创建时间。

**Tab 3: 关联快递明细**
- V1.1 显示空状态：「该订单尚未参与中通明细同步。同步功能将在 V1.3 上线。」

**Tab 4: 事件流**
- 时间倒序列出 `order_events`，每行展示：事件类型徽章 / 时间 / 操作者 / payload 摘要 (展开看完整 JSON).

Use TanStack Query: `useQuery(['order', id], () => getOrder(id))` and `useQuery(['order-events', id], () => listOrderEvents(id))`.

"作废" 按钮使用 `Popconfirm` 让用户填理由 → 调 `voidOrder` → 失效缓存 → 留在详情页。

## Task 10: Routes + menu + documentation

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/AppLayout.tsx`
- Modify: `README.md`, `docs/technical.md`, `docs/requirements.md`, `docs/user-guide.md`

- [ ] **Step 1: Add 4 routes to App.tsx**

```tsx
<Route path="/orders" element={<OrderList />} />
<Route path="/orders/new" element={<OrderEditor />} />
<Route path="/orders/:id" element={<OrderDetail />} />
<Route path="/orders/:id/edit" element={<OrderEditor />} />
```

- [ ] **Step 2: Activate menu group in AppLayout**

Replace the disabled `/orders` menu item with:

```tsx
{
  key: 'order-management',
  icon: <FileTextOutlined />,
  label: '订单管理',
  children: [
    { key: '/orders', label: '订单列表' },
    { key: '/orders/new', label: '新建订单' },
  ],
},
```

Update `getSelectedKey()` to map `/orders/:id*` → `/orders`, and `/orders/new` → `/orders/new`. Update `getOpenKeys()` to open `order-management` when on any `/orders/*` path.

- [ ] **Step 3: Update README.md**

Add a brief 订单管理 module mention to the module list. Note that V1.1 only supports manual single-order entry; import / sync are upcoming stages.

- [ ] **Step 4: Update docs/technical.md**

Add a 订单管理 V1.1 section covering:

- Data model summary (5 new tables + shipping_details columns)
- API surface table (8 endpoints)
- Expected issues estimation logic
- Order lifecycle (draft → pending_confirmation → active → void)

- [ ] **Step 5: Update docs/requirements.md**

Move 订单管理 from "未规划" to "V1.1 已交付" — single manual order, list, detail, void. Reference the V1 MVP design spec.

- [ ] **Step 6: Update docs/user-guide.md**

Add "如何创建一张订单" section: open 订单管理 → 新建订单 → fill form → 保存草稿 / 确认生效. Add "如何查看订单进度" section: open 订单列表 → click row → view 4 tabs.

## Verification

- [x] `cd backend && pytest` passes including new tests *(73 V1.1 tests pass; 8 pre-existing baseline failures unrelated to V1.1)*
- [x] `cd backend && alembic upgrade head` and `alembic downgrade -1` both succeed cleanly *(Task 1)*
- [x] `cd frontend && npx tsc --noEmit` clean
- [x] `cd frontend && npm run test -- orderUtils` passes *(31/31)*
- [ ] Manual smoke test: *(待用户在浏览器中验证)*
  - [ ] Login → 订单管理 → 订单列表 (empty state shown)
  - [ ] New order → fill 1 item + 1 target → save draft → list shows draft
  - [ ] Open draft → edit → confirm → list shows active with order_code
  - [ ] Open active order → see 4 tabs populate correctly
  - [ ] Tab 1 progress card shows: expected_at_creation matches a known value (e.g., 50 for full-year cbj 2026)
  - [ ] Create subscription order with coverage 2026-03-01 ~ 2027-02-28 → progress shows estimation > 40
  - [ ] Void an order with reason → status flips, void event appears in event stream
