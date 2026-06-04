# Order V1.2A Subscription Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the V1.2A order-entry pricing UX so operators choose subscription term, start month, and delivery/pricing method, then the system calculates coverage dates, expected issue count, package price, and subtotal.

**Architecture:** Add three persisted item fields (`subscription_term`, `delivery_method`, `term_start_month`) and a backend pricing preview service that derives coverage from `publication_schedule`. The frontend calls the preview endpoint from `OrderEditor`, displays a price preview card, persists the new fields on create, and shows them in `OrderDetail`. V1.2A does not sync orders to ZTO-MF and does not add a price-config admin page.

**Tech Stack:** FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2, pytest, React, TypeScript, Ant Design 5, TanStack Query.

---

## File Structure

### Backend

- Modify `backend/app/models/order_item.py`
  - Add `SubscriptionTerm` enum: `half_year`, `one_year`, `custom`.
  - Add `DeliveryMethod` enum: `post_office`, `zto_mf`.
  - Add columns: `subscription_term`, `delivery_method`, `term_start_month`.
- Modify `backend/app/models/__init__.py`
  - Export the two new enums.
- Add `backend/alembic/versions/f4a8c2d9e6b1_add_order_item_subscription_pricing_fields.py`
  - Add nullable columns to `order_items`.
  - Keep existing orders valid.
- Add `backend/app/services/order_pricing_service.py`
  - Central place for month-range calculation, schedule lookup, package pricing, and subtotal.
- Modify `backend/app/schemas/order.py`
  - Add input/output fields on `OrderItemIn` / `OrderItemOut`.
  - Add `PricingPreviewIn` / `PricingPreviewOut`.
- Modify `backend/app/services/order_service.py`
  - Persist new fields.
  - Recalculate non-custom subscription items on create using the backend pricing service.
- Modify `backend/app/api/orders.py`
  - Add `POST /api/orders/pricing-preview`.

### Backend tests

- Add `backend/tests/test_order_pricing_service.py`
  - Unit/integration tests for preview calculation.
- Modify `backend/tests/test_orders_api.py`
  - API tests for preview endpoint and persisted item fields.
- Modify `backend/tests/test_order_service.py`
  - Service-level persistence and recalculation tests.

### Frontend

- Modify `frontend/src/api/orders.ts`
  - Add `SubscriptionTerm`, `DeliveryMethod`, preview request/response types, and `previewOrderPricing()`.
  - Add fields to `OrderItemIn` / `OrderItemOut`.
- Modify `frontend/src/pages/OrderEditor.tsx`
  - Replace current date-range-only shortcut with start-month + term + delivery-method preview.
  - Display price preview card.
  - Persist new item fields.
  - Keep custom mode editable.
- Modify `frontend/src/pages/OrderDetail.tsx`
  - Show subscription term, delivery/pricing method, term start month, package price wording, and “每期总份数”.
- Modify `frontend/src/pages/orderUtils.ts`
  - Add labels for subscription term and delivery method.
- Modify `frontend/src/pages/orderUtils.test.ts`
  - Cover new label helpers.

### Documentation

- Modify `docs/technical.md`
  - Add the preview endpoint and new `order_items` fields.
- Modify `docs/user-guide.md`
  - Explain how to choose start month, term, delivery/pricing method, and custom mode.
- Modify `docs/requirements.md`
  - Add V1.2A pricing rules.

---

## Task 1: Persist subscription pricing fields

**Files:**
- Modify: `backend/app/models/order_item.py`
- Modify: `backend/app/models/__init__.py`
- Add: `backend/alembic/versions/f4a8c2d9e6b1_add_order_item_subscription_pricing_fields.py`
- Modify: `backend/app/schemas/order.py`
- Test: `backend/tests/test_orders_api.py`

- [ ] **Step 1: Write failing API round-trip test**

Append this test to `backend/tests/test_orders_api.py` after `test_create_order_returns_201_with_draft_status`:

```python
def test_create_order_round_trips_subscription_pricing_fields(client):
    payload = _make_create_payload()
    payload["items"][0].update(
        {
            "subscription_term": "half_year",
            "delivery_method": "zto_mf",
            "term_start_month": "2026-01",
            "unit_price": "195",
            "subtotal": "390",
            "total_quantity": 2,
        }
    )

    r = client.post("/api/orders", json=payload)

    assert r.status_code == 201, r.text
    item = r.json()["items"][0]
    assert item["subscription_term"] == "half_year"
    assert item["delivery_method"] == "zto_mf"
    assert item["term_start_month"] == "2026-01"
    assert item["unit_price"] == "195.00"
    assert item["subtotal"] == "390.00"
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
cd C:\Users\luyal\Repos\copilot-worktrees\FirstTry\acedawn-congenial-robot\backend
.\venv\Scripts\Activate.ps1
$env:PYTHONPATH=(Get-Location).Path
python -m pytest tests/test_orders_api.py::test_create_order_round_trips_subscription_pricing_fields -q
```

Expected: `FAILED` because response item does not contain `subscription_term`.

- [ ] **Step 3: Add model enums and columns**

In `backend/app/models/order_item.py`, add these enum classes after `OrderItemStatus`:

```python
class SubscriptionTerm(str, enum.Enum):
    half_year = "half_year"
    one_year = "one_year"
    custom = "custom"


class DeliveryMethod(str, enum.Enum):
    post_office = "post_office"
    zto_mf = "zto_mf"
```

Add these columns after `billing_type`:

```python
    subscription_term = Column(
        SAEnum(SubscriptionTerm),
        nullable=True,
    )
    delivery_method = Column(
        SAEnum(DeliveryMethod),
        nullable=True,
    )
    term_start_month = Column(String(7), nullable=True)
```

- [ ] **Step 4: Export enums**

In `backend/app/models/__init__.py`, add `SubscriptionTerm` and `DeliveryMethod` to the `order_item` import and `__all__`.

The import block should include:

```python
from app.models.order_item import (
    BillingType,
    DeliveryMethod,
    FulfillmentType,
    OrderItem,
    OrderItemStatus,
    Publication,
    PublicationFormat,
    SubscriptionTerm,
)
```

- [ ] **Step 5: Add Alembic migration**

Create `backend/alembic/versions/f4a8c2d9e6b1_add_order_item_subscription_pricing_fields.py`:

```python
"""add order item subscription pricing fields

Revision ID: f4a8c2d9e6b1
Revises: e9b3c5d7f1a4
Create Date: 2026-06-04
"""

from alembic import op
import sqlalchemy as sa


revision = "f4a8c2d9e6b1"
down_revision = "e9b3c5d7f1a4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "order_items",
        sa.Column(
            "subscription_term",
            sa.Enum("half_year", "one_year", "custom", name="subscriptionterm"),
            nullable=True,
        ),
    )
    op.add_column(
        "order_items",
        sa.Column(
            "delivery_method",
            sa.Enum("post_office", "zto_mf", name="deliverymethod"),
            nullable=True,
        ),
    )
    op.add_column("order_items", sa.Column("term_start_month", sa.String(length=7), nullable=True))


def downgrade() -> None:
    op.drop_column("order_items", "term_start_month")
    op.drop_column("order_items", "delivery_method")
    op.drop_column("order_items", "subscription_term")
```

- [ ] **Step 6: Add schema fields**

In `backend/app/schemas/order.py`, import `DeliveryMethod` and `SubscriptionTerm` from `app.models.order_item`, then add these fields to `OrderItemIn` after `billing_type`:

```python
    subscription_term: Optional[SubscriptionTerm] = None
    delivery_method: Optional[DeliveryMethod] = None
    term_start_month: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}$")
```

Add the same fields to `OrderItemOut` after `billing_type`:

```python
    subscription_term: Optional[SubscriptionTerm]
    delivery_method: Optional[DeliveryMethod]
    term_start_month: Optional[str]
```

- [ ] **Step 7: Persist fields in service**

In `backend/app/services/order_service.py`, add these keyword arguments to `OrderItem(...)` in `create_order_draft`:

```python
            subscription_term=item_data.subscription_term,
            delivery_method=item_data.delivery_method,
            term_start_month=item_data.term_start_month,
```

Place them after `billing_type=item_data.billing_type`.

- [ ] **Step 8: Run test to verify it passes**

Run:

```powershell
cd C:\Users\luyal\Repos\copilot-worktrees\FirstTry\acedawn-congenial-robot\backend
.\venv\Scripts\Activate.ps1
$env:PYTHONPATH=(Get-Location).Path
python -m pytest tests/test_orders_api.py::test_create_order_round_trips_subscription_pricing_fields -q
```

Expected: `1 passed`.

- [ ] **Step 9: Commit**

```powershell
cd C:\Users\luyal\Repos\copilot-worktrees\FirstTry\acedawn-congenial-robot
git add backend/app/models/order_item.py backend/app/models/__init__.py backend/alembic/versions/f4a8c2d9e6b1_add_order_item_subscription_pricing_fields.py backend/app/schemas/order.py backend/app/services/order_service.py backend/tests/test_orders_api.py
git commit -m "feat(orders): persist subscription pricing fields"
```

---

## Task 2: Backend pricing preview service

**Files:**
- Add: `backend/app/services/order_pricing_service.py`
- Add: `backend/tests/test_order_pricing_service.py`

- [ ] **Step 1: Write failing service tests**

Create `backend/tests/test_order_pricing_service.py`:

```python
from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import PublicationSchedule
from app.models.order_item import DeliveryMethod, SubscriptionTerm
from app.services.order_pricing_service import build_pricing_preview


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


def _seed_2026_first_half(db):
    rows = [
        PublicationSchedule(year=2026, issue_number=2601, publish_date=date(2026, 1, 5), is_suspended=False),
        PublicationSchedule(year=2026, issue_number=None, publish_date=date(2026, 2, 16), is_suspended=True),
        PublicationSchedule(year=2026, issue_number=2625, publish_date=date(2026, 6, 29), is_suspended=False),
    ]
    db.add_all(rows)
    db.commit()


def test_half_year_zto_preview_uses_first_and_last_non_suspended_issue(db):
    _seed_2026_first_half(db)

    preview = build_pricing_preview(
        db,
        subscription_term=SubscriptionTerm.half_year,
        delivery_method=DeliveryMethod.zto_mf,
        term_start_month="2026-01",
        total_quantity=2,
    )

    assert preview.month_range_label == "2026年1月～2026年6月"
    assert preview.coverage_start_date == date(2026, 1, 5)
    assert preview.coverage_end_date == date(2026, 6, 29)
    assert preview.expected_issue_count == 2
    assert preview.unit_price == 195
    assert preview.subtotal == 390
    assert preview.price_label == "ZTO-MF 快递半年套餐"
    assert preview.schedule_incomplete is False


@pytest.mark.parametrize(
    ("term", "method", "expected_price"),
    [
        (SubscriptionTerm.half_year, DeliveryMethod.post_office, 120),
        (SubscriptionTerm.half_year, DeliveryMethod.zto_mf, 195),
        (SubscriptionTerm.one_year, DeliveryMethod.post_office, 240),
        (SubscriptionTerm.one_year, DeliveryMethod.zto_mf, 390),
    ],
)
def test_package_price_table(db, term, method, expected_price):
    _seed_2026_first_half(db)

    preview = build_pricing_preview(
        db,
        subscription_term=term,
        delivery_method=method,
        term_start_month="2026-01",
        total_quantity=1,
    )

    assert preview.unit_price == expected_price
    assert preview.subtotal == expected_price


def test_preview_rejects_month_without_fulfillable_issue(db):
    with pytest.raises(ValueError, match="没有可履约出版期"):
        build_pricing_preview(
            db,
            subscription_term=SubscriptionTerm.half_year,
            delivery_method=DeliveryMethod.zto_mf,
            term_start_month="2026-01",
            total_quantity=1,
        )
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
cd C:\Users\luyal\Repos\copilot-worktrees\FirstTry\acedawn-congenial-robot\backend
.\venv\Scripts\Activate.ps1
$env:PYTHONPATH=(Get-Location).Path
python -m pytest tests/test_order_pricing_service.py -q
```

Expected: import failure for `app.services.order_pricing_service`.

- [ ] **Step 3: Implement service**

Create `backend/app/services/order_pricing_service.py`:

```python
from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import PublicationSchedule
from app.models.order_item import DeliveryMethod, SubscriptionTerm


PACKAGE_PRICES: dict[tuple[SubscriptionTerm, DeliveryMethod], Decimal] = {
    (SubscriptionTerm.half_year, DeliveryMethod.post_office): Decimal("120"),
    (SubscriptionTerm.half_year, DeliveryMethod.zto_mf): Decimal("195"),
    (SubscriptionTerm.one_year, DeliveryMethod.post_office): Decimal("240"),
    (SubscriptionTerm.one_year, DeliveryMethod.zto_mf): Decimal("390"),
}


@dataclass(frozen=True)
class PricingPreview:
    month_range_label: str
    coverage_start_date: date
    coverage_end_date: date
    expected_issue_count: int
    unit_price: Decimal
    subtotal: Decimal
    price_label: str
    schedule_incomplete: bool
    warning: str | None = None


def build_pricing_preview(
    db: Session,
    *,
    subscription_term: SubscriptionTerm,
    delivery_method: DeliveryMethod,
    term_start_month: str,
    total_quantity: int,
) -> PricingPreview:
    if subscription_term == SubscriptionTerm.custom:
        raise ValueError("自定义期限不支持自动套餐价预览")
    if total_quantity < 1:
        raise ValueError("每期总份数至少为 1")

    start_year, start_month = _parse_month(term_start_month)
    months = 6 if subscription_term == SubscriptionTerm.half_year else 12
    end_year, end_month = _add_months(start_year, start_month, months - 1)
    range_start = date(start_year, start_month, 1)
    range_end = date(end_year, end_month, calendar.monthrange(end_year, end_month)[1])

    first_issue = (
        db.query(func.min(PublicationSchedule.publish_date))
        .filter(
            PublicationSchedule.publish_date >= range_start,
            PublicationSchedule.publish_date <= range_end,
            PublicationSchedule.issue_number.isnot(None),
        )
        .scalar()
    )
    last_issue = (
        db.query(func.max(PublicationSchedule.publish_date))
        .filter(
            PublicationSchedule.publish_date >= range_start,
            PublicationSchedule.publish_date <= range_end,
            PublicationSchedule.issue_number.isnot(None),
        )
        .scalar()
    )
    issue_count = (
        db.query(func.count(PublicationSchedule.id))
        .filter(
            PublicationSchedule.publish_date >= range_start,
            PublicationSchedule.publish_date <= range_end,
            PublicationSchedule.issue_number.isnot(None),
        )
        .scalar()
        or 0
    )
    if first_issue is None or last_issue is None or issue_count == 0:
        raise ValueError("该月份范围内没有可履约出版期，请检查期刊表或改用自定义")

    latest_schedule_date = db.query(func.max(PublicationSchedule.publish_date)).scalar()
    schedule_incomplete = bool(latest_schedule_date is None or latest_schedule_date < range_end)
    unit_price = PACKAGE_PRICES[(subscription_term, delivery_method)]
    subtotal = unit_price * Decimal(total_quantity)
    term_label = "半年" if subscription_term == SubscriptionTerm.half_year else "一年"
    delivery_label = "ZTO-MF 快递" if delivery_method == DeliveryMethod.zto_mf else "邮局投递"

    return PricingPreview(
        month_range_label=f"{start_year}年{start_month}月～{end_year}年{end_month}月",
        coverage_start_date=first_issue,
        coverage_end_date=last_issue,
        expected_issue_count=int(issue_count),
        unit_price=unit_price,
        subtotal=subtotal,
        price_label=f"{delivery_label}{term_label}套餐",
        schedule_incomplete=schedule_incomplete,
        warning="期刊表尚未覆盖完整月份范围，请补齐后复核覆盖期" if schedule_incomplete else None,
    )


def _parse_month(value: str) -> tuple[int, int]:
    try:
        year_text, month_text = value.split("-", 1)
        year = int(year_text)
        month = int(month_text)
    except ValueError as exc:
        raise ValueError("起始月份格式必须为 YYYY-MM") from exc
    if month < 1 or month > 12:
        raise ValueError("起始月份格式必须为 YYYY-MM")
    return year, month


def _add_months(year: int, month: int, delta: int) -> tuple[int, int]:
    zero_based = (month - 1) + delta
    return year + zero_based // 12, zero_based % 12 + 1
```

- [ ] **Step 4: Run tests**

Run:

```powershell
cd C:\Users\luyal\Repos\copilot-worktrees\FirstTry\acedawn-congenial-robot\backend
.\venv\Scripts\Activate.ps1
$env:PYTHONPATH=(Get-Location).Path
python -m pytest tests/test_order_pricing_service.py -q
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
cd C:\Users\luyal\Repos\copilot-worktrees\FirstTry\acedawn-congenial-robot
git add backend/app/services/order_pricing_service.py backend/tests/test_order_pricing_service.py
git commit -m "feat(orders): add subscription pricing preview service"
```

---

## Task 3: Pricing preview API endpoint

**Files:**
- Modify: `backend/app/schemas/order.py`
- Modify: `backend/app/api/orders.py`
- Modify: `backend/tests/test_orders_api.py`

- [ ] **Step 1: Write failing API tests**

Add these imports to the top of `backend/tests/test_orders_api.py`:

```python
from datetime import date
from app.models import PublicationSchedule
```

Seed the existing `client` fixture. Add this block immediately after `Base.metadata.create_all(bind=engine)`:

```python
    seed_db = TestingSessionLocal()
    seed_db.add_all(
        [
            PublicationSchedule(year=2026, issue_number=2601, publish_date=date(2026, 1, 5), is_suspended=False),
            PublicationSchedule(year=2026, issue_number=None, publish_date=date(2026, 2, 16), is_suspended=True),
            PublicationSchedule(year=2026, issue_number=2625, publish_date=date(2026, 6, 29), is_suspended=False),
        ]
    )
    seed_db.commit()
    seed_db.close()
```

Append this test to `backend/tests/test_orders_api.py`:

```python

def test_pricing_preview_endpoint_returns_coverage_and_price(client):
    r = client.post(
        "/api/orders/pricing-preview",
        json={
            "subscription_term": "half_year",
            "delivery_method": "zto_mf",
            "term_start_month": "2026-01",
            "total_quantity": 2,
        },
    )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["coverage_start_date"] == "2026-01-05"
    assert body["coverage_end_date"] == "2026-06-29"
    assert body["expected_issue_count"] == 2
    assert body["unit_price"] == "195"
    assert body["subtotal"] == "390"
    assert body["price_label"] == "ZTO-MF 快递半年套餐"
```

- [ ] **Step 2: Run test to verify endpoint is missing**

Run:

```powershell
cd C:\Users\luyal\Repos\copilot-worktrees\FirstTry\acedawn-congenial-robot\backend
.\venv\Scripts\Activate.ps1
$env:PYTHONPATH=(Get-Location).Path
python -m pytest tests/test_orders_api.py::test_pricing_preview_endpoint_returns_coverage_and_price -q
```

Expected: `404 Not Found` or failing assertions.

- [ ] **Step 3: Add preview schemas**

In `backend/app/schemas/order.py`, add after `OrderVoidIn`:

```python
class PricingPreviewIn(BaseModel):
    subscription_term: SubscriptionTerm
    delivery_method: DeliveryMethod
    term_start_month: str = Field(pattern=r"^\d{4}-\d{2}$")
    total_quantity: int = Field(default=1, ge=1)


class PricingPreviewOut(BaseModel):
    month_range_label: str
    coverage_start_date: date
    coverage_end_date: date
    expected_issue_count: int
    unit_price: Decimal
    subtotal: Decimal
    price_label: str
    schedule_incomplete: bool = False
    warning: Optional[str] = None
```

- [ ] **Step 4: Add endpoint**

In `backend/app/api/orders.py`, import `HTTPException` and the preview schemas:

```python
from fastapi import APIRouter, Depends, HTTPException, Query
```

```python
from app.schemas.order import (
    FulfillmentProgress,
    OrderCreate,
    OrderEventOut,
    OrderListRow,
    OrderOut,
    OrderUpdate,
    OrderVoidIn,
    PricingPreviewIn,
    PricingPreviewOut,
)
from app.services.order_pricing_service import build_pricing_preview
```

Add this endpoint before `@router.get("/{order_id}")` so it does not get captured as an `order_id` path:

```python
@router.post("/pricing-preview", response_model=PricingPreviewOut)
def preview_pricing(
    data: PricingPreviewIn,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    try:
        return build_pricing_preview(
            db,
            subscription_term=data.subscription_term,
            delivery_method=data.delivery_method,
            term_start_month=data.term_start_month,
            total_quantity=data.total_quantity,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
```

- [ ] **Step 5: Verify API fixture seeding is present**

Confirm `backend/tests/test_orders_api.py` has the schedule seeding block from Step 1 immediately after `Base.metadata.create_all(bind=engine)`:

```python
    seed_db = TestingSessionLocal()
    seed_db.add_all(
        [
            PublicationSchedule(year=2026, issue_number=2601, publish_date=date(2026, 1, 5), is_suspended=False),
            PublicationSchedule(year=2026, issue_number=None, publish_date=date(2026, 2, 16), is_suspended=True),
            PublicationSchedule(year=2026, issue_number=2625, publish_date=date(2026, 6, 29), is_suspended=False),
        ]
    )
    seed_db.commit()
    seed_db.close()
```

Confirm the top of the file imports both:

```python
from datetime import date
from app.models import PublicationSchedule
```

- [ ] **Step 6: Run endpoint test**

Run:

```powershell
cd C:\Users\luyal\Repos\copilot-worktrees\FirstTry\acedawn-congenial-robot\backend
.\venv\Scripts\Activate.ps1
$env:PYTHONPATH=(Get-Location).Path
python -m pytest tests/test_orders_api.py::test_pricing_preview_endpoint_returns_coverage_and_price -q
```

Expected: `1 passed`.

- [ ] **Step 7: Commit**

```powershell
cd C:\Users\luyal\Repos\copilot-worktrees\FirstTry\acedawn-congenial-robot
git add backend/app/schemas/order.py backend/app/api/orders.py backend/tests/test_orders_api.py
git commit -m "feat(orders): expose subscription pricing preview API"
```

---

## Task 4: Recalculate package fields on create

**Files:**
- Modify: `backend/app/services/order_service.py`
- Modify: `backend/tests/test_order_service.py`
- Modify: `backend/tests/test_orders_api.py`

- [ ] **Step 1: Add integration test for create recalculation**

Append to `backend/tests/test_orders_api.py`:

```python
def test_create_order_recalculates_non_custom_subscription_package_fields(client):
    payload = _make_create_payload()
    payload["items"][0].update(
        {
            "subscription_term": "half_year",
            "delivery_method": "zto_mf",
            "term_start_month": "2026-01",
            "coverage_start_date": "2020-01-01",
            "coverage_end_date": "2020-01-02",
            "total_quantity": 2,
            "unit_price": "1",
            "subtotal": "2",
        }
    )

    r = client.post("/api/orders", json=payload)

    assert r.status_code == 201, r.text
    item = r.json()["items"][0]
    assert item["coverage_start_date"] == "2026-01-05"
    assert item["coverage_end_date"] == "2026-06-29"
    assert item["unit_price"] == "195.00"
    assert item["subtotal"] == "390.00"
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
cd C:\Users\luyal\Repos\copilot-worktrees\FirstTry\acedawn-congenial-robot\backend
.\venv\Scripts\Activate.ps1
$env:PYTHONPATH=(Get-Location).Path
python -m pytest tests/test_orders_api.py::test_create_order_recalculates_non_custom_subscription_package_fields -q
```

Expected: fails because create persists client-supplied wrong dates/prices.

- [ ] **Step 3: Implement create recalculation**

In `backend/app/services/order_service.py`, import:

```python
from app.models.order_item import SubscriptionTerm
from app.services.order_pricing_service import build_pricing_preview
```

Inside `create_order_draft`, before constructing `OrderItem`, add:

```python
        coverage_start_date = item_data.coverage_start_date
        coverage_end_date = item_data.coverage_end_date
        unit_price = item_data.unit_price
        subtotal = item_data.subtotal
        if (
            item_data.subscription_term is not None
            and item_data.subscription_term != SubscriptionTerm.custom
            and item_data.delivery_method is not None
            and item_data.term_start_month is not None
        ):
            preview = build_pricing_preview(
                db,
                subscription_term=item_data.subscription_term,
                delivery_method=item_data.delivery_method,
                term_start_month=item_data.term_start_month,
                total_quantity=item_data.total_quantity,
            )
            coverage_start_date = preview.coverage_start_date
            coverage_end_date = preview.coverage_end_date
            unit_price = preview.unit_price
            subtotal = preview.subtotal
```

Then use the local variables in `OrderItem(...)`:

```python
            coverage_start_date=coverage_start_date,
            coverage_end_date=coverage_end_date,
            unit_price=unit_price,
            subtotal=subtotal,
```

- [ ] **Step 4: Run create recalculation test**

Run:

```powershell
cd C:\Users\luyal\Repos\copilot-worktrees\FirstTry\acedawn-congenial-robot\backend
.\venv\Scripts\Activate.ps1
$env:PYTHONPATH=(Get-Location).Path
python -m pytest tests/test_orders_api.py::test_create_order_recalculates_non_custom_subscription_package_fields -q
```

Expected: `1 passed`.

- [ ] **Step 5: Run all order backend tests**

Run:

```powershell
cd C:\Users\luyal\Repos\copilot-worktrees\FirstTry\acedawn-congenial-robot\backend
.\venv\Scripts\Activate.ps1
$env:PYTHONPATH=(Get-Location).Path
python -m pytest tests/test_order_pricing_service.py tests/test_orders_api.py tests/test_order_service.py tests/test_order_code_service.py tests/test_expected_issues_calculator.py -q
```

Expected: all selected order tests pass.

- [ ] **Step 6: Commit**

```powershell
cd C:\Users\luyal\Repos\copilot-worktrees\FirstTry\acedawn-congenial-robot
git add backend/app/services/order_service.py backend/tests/test_orders_api.py
git commit -m "feat(orders): recalculate subscription package fields on create"
```

---

## Task 5: Frontend API types and label helpers

**Files:**
- Modify: `frontend/src/api/orders.ts`
- Modify: `frontend/src/pages/orderUtils.ts`
- Modify: `frontend/src/pages/orderUtils.test.ts`

- [ ] **Step 1: Write failing label helper tests**

Append to `frontend/src/pages/orderUtils.test.ts`:

```ts
import { deliveryMethodLabel, subscriptionTermLabel } from './orderUtils';

describe('subscription pricing labels', () => {
  it('formats subscription term labels', () => {
    expect(subscriptionTermLabel('half_year')).toBe('半年');
    expect(subscriptionTermLabel('one_year')).toBe('一年');
    expect(subscriptionTermLabel('custom')).toBe('自定义');
  });

  it('formats delivery method labels', () => {
    expect(deliveryMethodLabel('post_office')).toBe('邮局投递');
    expect(deliveryMethodLabel('zto_mf')).toBe('ZTO-MF 快递');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
cd C:\Users\luyal\Repos\copilot-worktrees\FirstTry\acedawn-congenial-robot\frontend
npx vitest run src/pages/orderUtils.test.ts --reporter=dot
```

Expected: fails because helpers do not exist.

- [ ] **Step 3: Add API types and client**

In `frontend/src/api/orders.ts`, add:

```ts
export type SubscriptionTerm = 'half_year' | 'one_year' | 'custom';
export type DeliveryMethod = 'post_office' | 'zto_mf';
```

Add fields to `OrderItemIn`:

```ts
  subscription_term?: SubscriptionTerm | null;
  delivery_method?: DeliveryMethod | null;
  term_start_month?: string | null;
```

Add fields to `OrderItemOut`:

```ts
  subscription_term: SubscriptionTerm | null;
  delivery_method: DeliveryMethod | null;
  term_start_month: string | null;
```

Add preview types:

```ts
export interface PricingPreviewPayload {
  subscription_term: Exclude<SubscriptionTerm, 'custom'>;
  delivery_method: DeliveryMethod;
  term_start_month: string;
  total_quantity: number;
}

export interface PricingPreviewOut {
  month_range_label: string;
  coverage_start_date: string;
  coverage_end_date: string;
  expected_issue_count: number;
  unit_price: string;
  subtotal: string;
  price_label: string;
  schedule_incomplete: boolean;
  warning: string | null;
}
```

Add API function near other exports:

```ts
export function previewOrderPricing(payload: PricingPreviewPayload): Promise<AxiosResponse<PricingPreviewOut>> {
  return api.post('/orders/pricing-preview', payload);
}
```

- [ ] **Step 4: Add label helpers**

In `frontend/src/pages/orderUtils.ts`, add these helpers near the other label functions:

```ts
export function subscriptionTermLabel(value: string | null | undefined): string {
  if (value === 'half_year') return '半年';
  if (value === 'one_year') return '一年';
  if (value === 'custom') return '自定义';
  return '未设置';
}

export function deliveryMethodLabel(value: string | null | undefined): string {
  if (value === 'post_office') return '邮局投递';
  if (value === 'zto_mf') return 'ZTO-MF 快递';
  return '未设置';
}
```

- [ ] **Step 5: Run frontend helper tests**

Run:

```powershell
cd C:\Users\luyal\Repos\copilot-worktrees\FirstTry\acedawn-congenial-robot\frontend
npx vitest run src/pages/orderUtils.test.ts --reporter=dot
```

Expected: tests pass.

- [ ] **Step 6: Commit**

```powershell
cd C:\Users\luyal\Repos\copilot-worktrees\FirstTry\acedawn-congenial-robot
git add frontend/src/api/orders.ts frontend/src/pages/orderUtils.ts frontend/src/pages/orderUtils.test.ts
git commit -m "feat(orders): add subscription pricing frontend types"
```

---

## Task 6: OrderEditor pricing preview UX

**Files:**
- Modify: `frontend/src/pages/OrderEditor.tsx`

- [ ] **Step 1: Replace frontend-only term values**

In `OrderEditor.tsx`, remove the local `SubscriptionTerm` type and import backend-aligned types:

```ts
  DeliveryMethod,
  PricingPreviewOut,
  SubscriptionTerm,
```

from `../api/orders`.

Change the one-year option value from `full_year` to `one_year`:

```ts
const SUBSCRIPTION_TERM_OPTIONS: Array<{ label: string; value: SubscriptionTerm }> = [
  { label: '半年', value: 'half_year' },
  { label: '一年', value: 'one_year' },
  { label: '自定义', value: 'custom' },
];
```

Delete `computeCoverageRange()` because coverage for half/year is now backend-driven.

- [ ] **Step 2: Add delivery method options and item form fields**

Add constants near subscription options:

```ts
const DELIVERY_METHOD_OPTIONS: Array<{ label: string; value: DeliveryMethod }> = [
  { label: '邮局投递（半年120 / 一年240）', value: 'post_office' },
  { label: 'ZTO-MF 快递（半年195 / 一年390）', value: 'zto_mf' },
];
```

Add fields to `ItemFormValues`:

```ts
  delivery_method?: DeliveryMethod | null;
  term_start_month?: Dayjs | null;
```

Update `buildBlankItem()`:

```ts
    coverage_range: null,
    subscription_term: 'half_year',
    delivery_method: 'zto_mf',
    term_start_month: dayjs().startOf('month'),
    unit_price: 195,
```

- [ ] **Step 3: Persist and restore fields**

In `detailToFormValues`, set:

```ts
        subscription_term: it.subscription_term ?? (isCoverageType ? 'custom' : null),
        delivery_method: it.delivery_method,
        term_start_month: it.term_start_month ? dayjs(`${it.term_start_month}-01`) : null,
```

In `itemToCreatePayload`, add:

```ts
    subscription_term: item.subscription_term ?? null,
    delivery_method: item.delivery_method ?? null,
    term_start_month: item.term_start_month ? item.term_start_month.format('YYYY-MM') : null,
```

- [ ] **Step 4: Add preview query/mutation**

Import `previewOrderPricing`.

Inside `ItemBlock`, watch:

```ts
  const deliveryMethod = Form.useWatch<DeliveryMethod | undefined | null>(
    ['items', field.name, 'delivery_method'],
    form,
  );
  const termStartMonth = Form.useWatch<Dayjs | undefined | null>(
    ['items', field.name, 'term_start_month'],
    form,
  );
```

Add a local query:

```ts
  const previewQuery = useQuery({
    queryKey: [
      'orders',
      'pricing-preview',
      subscriptionTerm,
      deliveryMethod,
      termStartMonth?.format('YYYY-MM'),
      totalQuantity,
    ],
    queryFn: async () => {
      const res = await previewOrderPricing({
        subscription_term: subscriptionTerm as Exclude<SubscriptionTerm, 'custom'>,
        delivery_method: deliveryMethod as DeliveryMethod,
        term_start_month: termStartMonth!.format('YYYY-MM'),
        total_quantity: Number(totalQuantity) || 1,
      });
      return res.data;
    },
    enabled:
      requireCoverage &&
      subscriptionTerm !== 'custom' &&
      !!subscriptionTerm &&
      !!deliveryMethod &&
      !!termStartMonth,
  });
```

Add effect to apply preview:

```ts
  useEffect(() => {
    const preview = previewQuery.data;
    if (!preview || disabled || subscriptionTerm === 'custom') return;
    form.setFieldValue(['items', field.name, 'coverage_range'], [
      dayjs(preview.coverage_start_date),
      dayjs(preview.coverage_end_date),
    ]);
    form.setFieldValue(['items', field.name, 'unit_price'], Number(preview.unit_price));
  }, [previewQuery.data, disabled, subscriptionTerm, form, field.name]);
```

- [ ] **Step 5: Replace term UI controls**

Replace current `coverage_range` + subscription term row for coverage items with:

```tsx
{requireCoverage && (
  <>
    <Row gutter={12}>
      <Col span={6}>
        <Form.Item name={[field.name, 'subscription_term']} label="订阅期限" rules={[{ required: true, message: '请选择订阅期限' }]}>
          <Radio.Group options={SUBSCRIPTION_TERM_OPTIONS} optionType="button" disabled={disabled} />
        </Form.Item>
      </Col>
      <Col span={6}>
        <Form.Item name={[field.name, 'term_start_month']} label="起始月份" rules={subscriptionTerm !== 'custom' ? [{ required: true, message: '请选择起始月份' }] : undefined}>
          <DatePicker picker="month" style={{ width: '100%' }} disabled={disabled || subscriptionTerm === 'custom'} />
        </Form.Item>
      </Col>
      <Col span={12}>
        <Form.Item name={[field.name, 'delivery_method']} label="投递/收费方式" rules={[{ required: true, message: '请选择投递/收费方式' }]}>
          <Radio.Group options={DELIVERY_METHOD_OPTIONS} disabled={disabled} />
        </Form.Item>
      </Col>
    </Row>
    <Form.Item
      name={[field.name, 'coverage_range']}
      label="实际覆盖期"
      rules={[{ required: true, message: '请通过预览生成或手动填写覆盖期' }]}
    >
      <DatePicker.RangePicker style={{ width: '100%' }} disabled={disabled || subscriptionTerm !== 'custom'} />
    </Form.Item>
  </>
)}
```

- [ ] **Step 6: Add preview card**

Below the coverage controls, add:

```tsx
{requireCoverage && subscriptionTerm !== 'custom' && (
  <Alert
    type={previewQuery.data?.schedule_incomplete ? 'warning' : 'info'}
    showIcon
    message={previewQuery.isLoading ? '正在计算套餐价...' : previewQuery.data?.price_label ?? '请选择起始月份和投递方式'}
    description={
      previewQuery.data ? (
        <Space direction="vertical" size={2}>
          <span>实际覆盖期：{previewQuery.data.coverage_start_date} ～ {previewQuery.data.coverage_end_date}</span>
          <span>预计发货：{previewQuery.data.expected_issue_count} 期</span>
          <span>单份套餐价：{formatCurrency(previewQuery.data.unit_price)}</span>
          <span>每期总份数：{Number(totalQuantity) || 0}</span>
          <span>应收小计：{formatCurrency(previewQuery.data.subtotal)}</span>
          {previewQuery.data.warning && <Text type="warning">{previewQuery.data.warning}</Text>}
        </Space>
      ) : previewQuery.isError ? (
        '预览失败：请检查期刊表或改用自定义。'
      ) : undefined
    }
    style={{ marginBottom: 12 }}
  />
)}
```

- [ ] **Step 7: Rename labels**

Change labels:

- `总份数` → `每期总份数`
- `单价` → `单份套餐价`
- `小计` → `应收小计`
- target tag text: `目标合计 {targetSum} / 每期总份数 {Number(totalQuantity) || 0}`

- [ ] **Step 8: Run TypeScript**

Run:

```powershell
cd C:\Users\luyal\Repos\copilot-worktrees\FirstTry\acedawn-congenial-robot\frontend
npx tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 9: Commit**

```powershell
cd C:\Users\luyal\Repos\copilot-worktrees\FirstTry\acedawn-congenial-robot
git add frontend/src/pages/OrderEditor.tsx
git commit -m "feat(orders): add subscription pricing preview UI"
```

---

## Task 7: OrderDetail display updates

**Files:**
- Modify: `frontend/src/pages/OrderDetail.tsx`

- [ ] **Step 1: Import label helpers**

Add to the `orderUtils` import:

```ts
  deliveryMethodLabel,
  subscriptionTermLabel,
```

- [ ] **Step 2: Update item descriptions**

In `ItemCard`, add description rows:

```tsx
<Descriptions.Item label="订阅期限">
  {subscriptionTermLabel(item.subscription_term)}
</Descriptions.Item>
<Descriptions.Item label="投递方式">
  {deliveryMethodLabel(item.delivery_method)}
</Descriptions.Item>
<Descriptions.Item label="起始月份">
  {item.term_start_month ?? '-'}
</Descriptions.Item>
```

Change labels:

```tsx
<Descriptions.Item label="每期总份数">
  {item.total_quantity}
</Descriptions.Item>
<Descriptions.Item label="单份套餐价">
  {formatCurrency(item.unit_price)}
</Descriptions.Item>
<Descriptions.Item label="应收小计">
  {formatCurrency(subtotal)}
</Descriptions.Item>
```

- [ ] **Step 3: Run TypeScript**

Run:

```powershell
cd C:\Users\luyal\Repos\copilot-worktrees\FirstTry\acedawn-congenial-robot\frontend
npx tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```powershell
cd C:\Users\luyal\Repos\copilot-worktrees\FirstTry\acedawn-congenial-robot
git add frontend/src/pages/OrderDetail.tsx
git commit -m "feat(orders): show subscription pricing details"
```

---

## Task 8: Documentation and full verification

**Files:**
- Modify: `docs/technical.md`
- Modify: `docs/user-guide.md`
- Modify: `docs/requirements.md`

- [ ] **Step 1: Update technical docs**

In `docs/technical.md`, update the order management section to include:

```markdown
#### POST /api/orders/pricing-preview

根据订阅期限、起始月份、投递/收费方式、每期总份数，预览实际覆盖期和套餐价。

请求：
```json
{
  "subscription_term": "half_year",
  "delivery_method": "zto_mf",
  "term_start_month": "2026-01",
  "total_quantity": 2
}
```

响应：
```json
{
  "month_range_label": "2026年1月～2026年6月",
  "coverage_start_date": "2026-01-05",
  "coverage_end_date": "2026-06-29",
  "expected_issue_count": 23,
  "unit_price": 195,
  "subtotal": 390,
  "price_label": "ZTO-MF 快递半年套餐",
  "schedule_incomplete": false,
  "warning": null
}
```
```

Also add `subscription_term`, `delivery_method`, and `term_start_month` to the `order_items` field table.

- [ ] **Step 2: Update user guide**

In `docs/user-guide.md`, add a subsection under order creation:

```markdown
**订阅期限与套餐价**

新建订阅类订单时，先选择「半年 / 一年 / 自定义」。

- 半年 / 一年：选择起始月份和投递/收费方式后，系统自动从期刊表计算实际覆盖期、预计发货期数、单份套餐价和应收小计。
- 邮局投递：半年 120 元，一年 240 元。
- ZTO-MF 快递：半年 195 元，一年 390 元。
- 自定义：手工填写覆盖期和单份套餐价。

「每期总份数」是每一期要寄出的份数，不是整个订阅周期的报纸总量。
```

- [ ] **Step 3: Update requirements**

In `docs/requirements.md`, add V1.2A rules:

```markdown
### 订单 V1.2A：订阅期限与套餐价

- 半年/一年按起始月份换算为实际出版期覆盖范围。
- 休刊不补偿、不顺延。
- 邮局投递价格：半年 120 元，一年 240 元。
- ZTO-MF 快递价格：半年 195 元，一年 390 元。
- 小计 = 单份套餐价 × 每期总份数。
- 自定义期限允许人工填写覆盖期和价格。
```

- [ ] **Step 4: Run backend order tests**

Run:

```powershell
cd C:\Users\luyal\Repos\copilot-worktrees\FirstTry\acedawn-congenial-robot\backend
.\venv\Scripts\Activate.ps1
$env:PYTHONPATH=(Get-Location).Path
python -m pytest tests/test_order_pricing_service.py tests/test_orders_api.py tests/test_order_service.py tests/test_order_code_service.py tests/test_expected_issues_calculator.py -q
```

Expected: all selected order tests pass.

- [ ] **Step 5: Run frontend checks**

Run:

```powershell
cd C:\Users\luyal\Repos\copilot-worktrees\FirstTry\acedawn-congenial-robot\frontend
npx vitest run src/pages/orderUtils.test.ts --reporter=dot
npx tsc --noEmit
```

Expected: Vitest passes and TypeScript has no errors.

- [ ] **Step 6: Run migration locally**

Run:

```powershell
cd C:\Users\luyal\Repos\copilot-worktrees\FirstTry\acedawn-congenial-robot\backend
.\venv\Scripts\Activate.ps1
alembic upgrade head
```

Expected: migration reaches `f4a8c2d9e6b1`.

- [ ] **Step 7: Manual smoke test**

Start or refresh services, then open `http://localhost:5173/orders/new`.

Verify:

1. Choose subscription term `半年`.
2. Choose start month `2026-01`.
3. Choose `ZTO-MF 快递`.
4. Add two recipients with quantity 1 each.
5. Confirm preview shows package price 195 and subtotal 390.
6. Save draft.
7. Open order detail and verify term, delivery method, start month, coverage date, unit price, subtotal, and targets are shown.

- [ ] **Step 8: Commit docs**

```powershell
cd C:\Users\luyal\Repos\copilot-worktrees\FirstTry\acedawn-congenial-robot
git add docs/technical.md docs/user-guide.md docs/requirements.md
git commit -m "docs(orders): document V1.2A subscription pricing"
```

---

## Self-Review

### Spec coverage

- Half/year/custom term: Task 1, Task 2, Task 6, Task 8.
- Delivery/pricing method: Task 1, Task 2, Task 5, Task 6, Task 7.
- Schedule-derived coverage: Task 2, Task 3, Task 4.
- Package price table 120/240/195/390: Task 2 tests and service constants.
- Subtotal semantics: Task 2, Task 6, Task 7, Task 8.
- Custom mode: Task 2 rejects preview and Task 6 keeps editable coverage/date fields.
- No ZTO-MF sync: documented as non-goal; no task touches shipping sync.
- Docs: Task 8.

### Placeholder scan

This plan contains no placeholder requirements. Each task has exact files, commands, expected outcomes, and code snippets.

### Type consistency

Backend and frontend use the same enum values:

- `SubscriptionTerm`: `half_year`, `one_year`, `custom`
- `DeliveryMethod`: `post_office`, `zto_mf`

The prior frontend-only value `full_year` must be replaced everywhere by `one_year` in Task 6.
