# 中国经营报 · 每周印数报数系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web app (FastAPI + React) that generates weekly print report Excel files and ZTO shipping manifests for 《中国经营报》.

**Architecture:** FastAPI backend serves a React frontend (built as static files in production). MySQL stores all data. openpyxl generates Excel exports from templates. The system auto-determines the next issue number from a publication schedule table, copies previous issue data as defaults, and lets the user edit only the variable fields before exporting.

**Tech Stack:** Python 3.11+ / FastAPI / SQLAlchemy / Alembic / openpyxl / React 18 / TypeScript / Vite / Arco Design (@arco-design/web-react) / MySQL

**Database:** `mysql://ace:EjcT&^h0zYv8Tp@bj-cdb-8qudxjds.sql.tencentcdb.com:24433/zgjyb` (stored in `.env`, never committed)

---

## Phase 1: Backend Foundation

### Task 1: Project Scaffolding

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/app/__init__.py`
- Create: `backend/app/main.py`
- Create: `backend/app/config.py`
- Create: `backend/app/database.py`
- Create: `.env`
- Create: `.gitignore`

- [ ] **Step 1: Create `.gitignore`**

```gitignore
# Python
__pycache__/
*.py[cod]
*.egg-info/
dist/
build/
venv/
.venv/

# Environment
.env

# Node
node_modules/
frontend/dist/

# IDE
.vscode/
.idea/

# OS
.DS_Store
Thumbs.db

# Superpowers
.superpowers/
```

- [ ] **Step 2: Create `.env`**

```env
MYSQL_HOST=bj-cdb-8qudxjds.sql.tencentcdb.com
MYSQL_PORT=24433
MYSQL_USER=ace
MYSQL_PASSWORD=EjcT&^h0zYv8Tp
MYSQL_DATABASE=zgjyb
```

- [ ] **Step 3: Create `backend/requirements.txt`**

```
fastapi==0.115.0
uvicorn[standard]==0.30.0
sqlalchemy==2.0.35
pymysql==1.1.1
cryptography==43.0.0
alembic==1.13.2
python-dotenv==1.0.1
openpyxl==3.1.5
pandas==2.2.2
pydantic==2.9.0
pydantic-settings==2.5.0
python-multipart==0.0.9
```

- [ ] **Step 4: Create `backend/app/__init__.py`**

Empty file.

- [ ] **Step 5: Create `backend/app/config.py`**

```python
from pydantic_settings import BaseSettings
from functools import lru_cache
import os


class Settings(BaseSettings):
    MYSQL_HOST: str
    MYSQL_PORT: int = 24433
    MYSQL_USER: str
    MYSQL_PASSWORD: str
    MYSQL_DATABASE: str

    @property
    def DATABASE_URL(self) -> str:
        return (
            f"mysql+pymysql://{self.MYSQL_USER}:{self.MYSQL_PASSWORD}"
            f"@{self.MYSQL_HOST}:{self.MYSQL_PORT}/{self.MYSQL_DATABASE}"
            "?charset=utf8mb4"
        )

    model_config = {"env_file": os.path.join(os.path.dirname(__file__), "..", "..", ".env")}


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 6: Create `backend/app/database.py`**

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

from app.config import get_settings

engine = create_engine(get_settings().DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

- [ ] **Step 7: Create `backend/app/main.py`**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="中国经营报 · 印数报数系统", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health_check():
    return {"status": "ok"}
```

- [ ] **Step 8: Install dependencies and verify server starts**

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Visit `http://localhost:8000/api/health` — expect `{"status":"ok"}`.

- [ ] **Step 9: Commit**

```bash
git add .gitignore backend/ .env
# Note: .env is in .gitignore so won't be committed
git commit -m "feat: backend project scaffolding with FastAPI + MySQL config"
```

---

### Task 2: Database Models

**Files:**
- Create: `backend/app/models/__init__.py`
- Create: `backend/app/models/publication_schedule.py`
- Create: `backend/app/models/issue.py`
- Create: `backend/app/models/report_item_template.py`
- Create: `backend/app/models/report_entry.py`
- Create: `backend/app/models/recipient.py`
- Create: `backend/app/models/subscription.py`
- Create: `backend/app/models/shipping_record.py`

- [ ] **Step 1: Create `backend/app/models/publication_schedule.py`**

```python
from sqlalchemy import Column, Integer, Date, Boolean, UniqueConstraint
from app.database import Base


class PublicationSchedule(Base):
    __tablename__ = "publication_schedule"

    id = Column(Integer, primary_key=True, autoincrement=True)
    year = Column(Integer, nullable=False)
    issue_number = Column(Integer, nullable=False)
    publish_date = Column(Date, nullable=False)
    is_suspended = Column(Boolean, default=False, nullable=False)

    __table_args__ = (UniqueConstraint("year", "issue_number"),)
```

- [ ] **Step 2: Create `backend/app/models/issue.py`**

```python
from sqlalchemy import Column, Integer, Date, String, Text, DateTime, Enum as SAEnum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base
import enum


class IssueStatus(str, enum.Enum):
    draft = "draft"
    confirmed = "confirmed"
    exported = "exported"


class Issue(Base):
    __tablename__ = "issues"

    id = Column(Integer, primary_key=True, autoincrement=True)
    issue_number = Column(Integer, nullable=False, unique=True)
    publish_date = Column(Date, nullable=False)
    status = Column(SAEnum(IssueStatus), default=IssueStatus.draft, nullable=False)
    notes = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    report_entries = relationship("ReportEntry", back_populates="issue", cascade="all, delete-orphan")
    shipping_records = relationship("ShippingRecord", back_populates="issue", cascade="all, delete-orphan")
```

- [ ] **Step 3: Create `backend/app/models/report_item_template.py`**

```python
from sqlalchemy import Column, Integer, String, Boolean, UniqueConstraint
from app.database import Base


class ReportItemTemplate(Base):
    __tablename__ = "report_item_templates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    category = Column(String(50), nullable=False)
    sub_category = Column(String(100), nullable=False)
    display_name = Column(String(100), nullable=False)
    default_value = Column(Integer, default=0)
    is_variable = Column(Boolean, default=False, nullable=False)
    sort_order = Column(Integer, default=0)
    excel_sheet = Column(String(50))
    excel_cell = Column(String(10))

    __table_args__ = (UniqueConstraint("category", "sub_category"),)
```

- [ ] **Step 4: Create `backend/app/models/report_entry.py`**

```python
from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from app.database import Base


class ReportEntry(Base):
    __tablename__ = "report_entries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    issue_id = Column(Integer, ForeignKey("issues.id", ondelete="CASCADE"), nullable=False)
    category = Column(String(50), nullable=False)
    sub_category = Column(String(100), nullable=False)
    value = Column(Integer, default=0)
    is_variable = Column(Boolean, default=False)

    issue = relationship("Issue", back_populates="report_entries")

    __table_args__ = (UniqueConstraint("issue_id", "category", "sub_category"),)
```

- [ ] **Step 5: Create `backend/app/models/recipient.py`**

```python
from sqlalchemy import Column, Integer, String, Text, DateTime, Enum as SAEnum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base
import enum


class RecipientType(str, enum.Enum):
    corporate = "corporate"
    reader = "reader"
    sample = "sample"


class RecipientFrequency(str, enum.Enum):
    weekly = "weekly"
    biweekly = "biweekly"
    monthly = "monthly"


class RecipientStatus(str, enum.Enum):
    active = "active"
    suspended = "suspended"


class Recipient(Base):
    __tablename__ = "recipients"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    phone = Column(String(20))
    province = Column(String(50))
    city = Column(String(50))
    address = Column(Text)
    type = Column(SAEnum(RecipientType), nullable=False)
    frequency = Column(SAEnum(RecipientFrequency), default=RecipientFrequency.weekly)
    status = Column(SAEnum(RecipientStatus), default=RecipientStatus.active)
    notes = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    subscriptions = relationship("Subscription", back_populates="recipient", cascade="all, delete-orphan")
    shipping_records = relationship("ShippingRecord", back_populates="recipient")
```

- [ ] **Step 6: Create `backend/app/models/subscription.py`**

```python
from sqlalchemy import Column, Integer, Date, Text, DateTime, ForeignKey, Enum as SAEnum, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base
import enum


class SubscriptionType(str, enum.Enum):
    new = "new"
    renewal = "renewal"


class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    recipient_id = Column(Integer, ForeignKey("recipients.id", ondelete="CASCADE"), nullable=False)
    type = Column(SAEnum(SubscriptionType), nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    duration_months = Column(Integer)
    quantity = Column(Integer, default=1)
    notes = Column(Text)
    created_at = Column(DateTime, server_default=func.now())

    recipient = relationship("Recipient", back_populates="subscriptions")

    __table_args__ = (Index("idx_recipient_created", "recipient_id", "created_at"),)
```

- [ ] **Step 7: Create `backend/app/models/shipping_record.py`**

```python
from sqlalchemy import Column, Integer, ForeignKey, UniqueConstraint, Enum as SAEnum
from sqlalchemy.orm import relationship
from app.database import Base
import enum


class ShippingStatus(str, enum.Enum):
    pending = "pending"
    shipped = "shipped"


class ShippingRecord(Base):
    __tablename__ = "shipping_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    issue_id = Column(Integer, ForeignKey("issues.id", ondelete="CASCADE"), nullable=False)
    recipient_id = Column(Integer, ForeignKey("recipients.id", ondelete="CASCADE"), nullable=False)
    quantity = Column(Integer, default=0)
    status = Column(SAEnum(ShippingStatus), default=ShippingStatus.pending)

    issue = relationship("Issue", back_populates="shipping_records")
    recipient = relationship("Recipient", back_populates="shipping_records")

    __table_args__ = (UniqueConstraint("issue_id", "recipient_id"),)
```

- [ ] **Step 8: Create `backend/app/models/__init__.py`**

```python
from app.models.publication_schedule import PublicationSchedule
from app.models.issue import Issue, IssueStatus
from app.models.report_item_template import ReportItemTemplate
from app.models.report_entry import ReportEntry
from app.models.recipient import Recipient, RecipientType, RecipientFrequency, RecipientStatus
from app.models.subscription import Subscription, SubscriptionType
from app.models.shipping_record import ShippingRecord, ShippingStatus

__all__ = [
    "PublicationSchedule",
    "Issue", "IssueStatus",
    "ReportItemTemplate",
    "ReportEntry",
    "Recipient", "RecipientType", "RecipientFrequency", "RecipientStatus",
    "Subscription", "SubscriptionType",
    "ShippingRecord", "ShippingStatus",
]
```

- [ ] **Step 9: Commit**

```bash
git add backend/app/models/
git commit -m "feat: add SQLAlchemy models for all 7 tables"
```

---

### Task 3: Alembic Setup & Initial Migration

**Files:**
- Create: `backend/alembic.ini`
- Create: `backend/alembic/env.py`
- Create: `backend/alembic/script.py.mako`
- Create: `backend/alembic/versions/` (auto-generated)

- [ ] **Step 1: Initialize Alembic**

```bash
cd backend
alembic init alembic
```

- [ ] **Step 2: Edit `backend/alembic/env.py`**

Replace the auto-generated `env.py` with:

```python
from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context

from app.config import get_settings
from app.database import Base
from app.models import *  # noqa: F401, F403 — import all models to register metadata

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", get_settings().DATABASE_URL)
target_metadata = Base.metadata


def run_migrations_offline():
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

- [ ] **Step 3: Generate initial migration**

```bash
cd backend
alembic revision --autogenerate -m "create all tables"
```

- [ ] **Step 4: Run migration against MySQL**

```bash
cd backend
alembic upgrade head
```

Verify: all 7 tables created in `zgjyb` database.

- [ ] **Step 5: Commit**

```bash
git add backend/alembic/ backend/alembic.ini
git commit -m "feat: add Alembic migrations, create all 7 tables"
```

---

### Task 4: Seed Publication Schedule Data

**Files:**
- Create: `backend/app/seeds/__init__.py`
- Create: `backend/app/seeds/publication_schedule_2026.py`

- [ ] **Step 1: Create `backend/app/seeds/__init__.py`**

Empty file.

- [ ] **Step 2: Create `backend/app/seeds/publication_schedule_2026.py`**

```python
"""Seed 2026 publication schedule from the official 刊期表."""
from datetime import date
from sqlalchemy.orm import Session
from app.models import PublicationSchedule


SCHEDULE_2026 = [
    # (month, day, issue_number, is_suspended)
    (1, 5, 2635, False), (1, 12, 2636, False), (1, 19, 2637, False), (1, 26, 2638, False),
    (2, 2, 2639, False), (2, 9, 2640, False), (2, 16, 0, True), (2, 23, 0, True),
    (3, 2, 2641, False), (3, 9, 2642, False), (3, 16, 2643, False), (3, 23, 2644, False), (3, 30, 2645, False),
    (4, 6, 2646, False), (4, 13, 2647, False), (4, 20, 2648, False), (4, 27, 2649, False),
    (5, 4, 2650, False), (5, 11, 2651, False), (5, 18, 2652, False), (5, 25, 2653, False),
    (6, 1, 2654, False), (6, 8, 2655, False), (6, 15, 2656, False), (6, 22, 2657, False), (6, 29, 2658, False),
    (7, 6, 2659, False), (7, 13, 2660, False), (7, 20, 2661, False), (7, 27, 2662, False),
    (8, 3, 2663, False), (8, 10, 2664, False), (8, 17, 2665, False), (8, 24, 2666, False), (8, 31, 2667, False),
    (9, 7, 2668, False), (9, 14, 2669, False), (9, 21, 2670, False), (9, 28, 2671, False),
    (10, 5, 0, True), (10, 12, 2672, False), (10, 19, 2673, False), (10, 26, 2674, False),
    (11, 2, 2675, False), (11, 9, 2676, False), (11, 16, 2677, False), (11, 23, 2678, False), (11, 30, 2679, False),
    (12, 7, 2680, False), (12, 14, 2681, False), (12, 21, 2682, False), (12, 28, 2683, False),
]


def seed_publication_schedule_2026(db: Session) -> int:
    """Insert 2026 schedule. Returns number of rows inserted. Skips if already seeded."""
    existing = db.query(PublicationSchedule).filter(PublicationSchedule.year == 2026).count()
    if existing > 0:
        return 0

    count = 0
    for month, day, issue_number, is_suspended in SCHEDULE_2026:
        entry = PublicationSchedule(
            year=2026,
            issue_number=issue_number if not is_suspended else 0,
            publish_date=date(2026, month, day),
            is_suspended=is_suspended,
        )
        db.add(entry)
        count += 1

    db.commit()
    return count
```

- [ ] **Step 3: Add seed CLI endpoint to `backend/app/main.py`**

Add to `main.py`:

```python
from app.database import get_db, SessionLocal
from app.seeds.publication_schedule_2026 import seed_publication_schedule_2026


@app.post("/api/admin/seed")
def run_seeds():
    db = SessionLocal()
    try:
        count = seed_publication_schedule_2026(db)
        return {"message": f"Seeded {count} publication schedule entries"}
    finally:
        db.close()
```

- [ ] **Step 4: Run seed via API**

Start server, then:
```bash
curl -X POST http://localhost:8000/api/admin/seed
```
Expected: `{"message":"Seeded 52 publication schedule entries"}`

- [ ] **Step 5: Commit**

```bash
git add backend/app/seeds/ backend/app/main.py
git commit -m "feat: seed 2026 publication schedule data"
```

---

### Task 5: Publication Schedule & Issues API

**Files:**
- Create: `backend/app/schemas/__init__.py`
- Create: `backend/app/schemas/schedule.py`
- Create: `backend/app/schemas/issue.py`
- Create: `backend/app/api/__init__.py`
- Create: `backend/app/api/schedule.py`
- Create: `backend/app/api/issues.py`
- Create: `backend/app/services/__init__.py`
- Create: `backend/app/services/issue_service.py`
- Modify: `backend/app/main.py` (register routers)

- [ ] **Step 1: Create Pydantic schemas**

`backend/app/schemas/__init__.py` — empty file.

`backend/app/schemas/schedule.py`:
```python
from pydantic import BaseModel
from datetime import date


class ScheduleEntry(BaseModel):
    id: int
    year: int
    issue_number: int
    publish_date: date
    is_suspended: bool

    model_config = {"from_attributes": True}
```

`backend/app/schemas/issue.py`:
```python
from pydantic import BaseModel
from datetime import date, datetime
from typing import Optional
from app.models.issue import IssueStatus


class IssueCreate(BaseModel):
    issue_number: int
    publish_date: date
    notes: Optional[str] = None


class IssueOut(BaseModel):
    id: int
    issue_number: int
    publish_date: date
    status: IssueStatus
    notes: Optional[str]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]

    model_config = {"from_attributes": True}


class NextIssueInfo(BaseModel):
    issue_number: int
    publish_date: date
    previous_issue_id: Optional[int] = None
```

- [ ] **Step 2: Create `backend/app/services/__init__.py`** (empty) and `backend/app/services/issue_service.py`**

```python
from datetime import date
from sqlalchemy.orm import Session
from sqlalchemy import desc
from app.models import PublicationSchedule, Issue, ReportEntry, ReportItemTemplate


def get_next_issue_info(db: Session) -> dict:
    """Determine the next issue number and publish date based on current date."""
    today = date.today()
    next_entry = (
        db.query(PublicationSchedule)
        .filter(PublicationSchedule.publish_date >= today, PublicationSchedule.is_suspended == False)
        .order_by(PublicationSchedule.publish_date.asc())
        .first()
    )
    if not next_entry:
        return None

    # Check if this issue already exists
    existing = db.query(Issue).filter(Issue.issue_number == next_entry.issue_number).first()
    if existing:
        # Find the one after
        next_entry = (
            db.query(PublicationSchedule)
            .filter(
                PublicationSchedule.publish_date > next_entry.publish_date,
                PublicationSchedule.is_suspended == False,
            )
            .order_by(PublicationSchedule.publish_date.asc())
            .first()
        )
        if not next_entry:
            return None

    # Find previous issue for copying data
    prev_issue = db.query(Issue).order_by(desc(Issue.issue_number)).first()

    return {
        "issue_number": next_entry.issue_number,
        "publish_date": next_entry.publish_date,
        "previous_issue_id": prev_issue.id if prev_issue else None,
    }


def create_issue_with_data(db: Session, issue_number: int, publish_date: date, notes: str = None) -> Issue:
    """Create a new issue and copy report entries from previous issue (or from templates)."""
    issue = Issue(issue_number=issue_number, publish_date=publish_date, notes=notes)
    db.add(issue)
    db.flush()  # get issue.id

    # Find previous issue
    prev_issue = (
        db.query(Issue)
        .filter(Issue.issue_number < issue_number)
        .order_by(desc(Issue.issue_number))
        .first()
    )

    if prev_issue:
        # Copy entries from previous issue
        prev_entries = db.query(ReportEntry).filter(ReportEntry.issue_id == prev_issue.id).all()
        for entry in prev_entries:
            new_entry = ReportEntry(
                issue_id=issue.id,
                category=entry.category,
                sub_category=entry.sub_category,
                value=entry.value,
                is_variable=entry.is_variable,
            )
            db.add(new_entry)
    else:
        # First issue: populate from templates
        templates = db.query(ReportItemTemplate).order_by(ReportItemTemplate.sort_order).all()
        for tmpl in templates:
            new_entry = ReportEntry(
                issue_id=issue.id,
                category=tmpl.category,
                sub_category=tmpl.sub_category,
                value=tmpl.default_value,
                is_variable=tmpl.is_variable,
            )
            db.add(new_entry)

    db.commit()
    db.refresh(issue)
    return issue
```

- [ ] **Step 3: Create API routers**

`backend/app/api/__init__.py` — empty file.

`backend/app/api/schedule.py`:
```python
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models import PublicationSchedule
from app.schemas.schedule import ScheduleEntry

router = APIRouter(prefix="/api/schedule", tags=["schedule"])


@router.get("", response_model=List[ScheduleEntry])
def list_schedule(year: int = 2026, db: Session = Depends(get_db)):
    return (
        db.query(PublicationSchedule)
        .filter(PublicationSchedule.year == year)
        .order_by(PublicationSchedule.publish_date)
        .all()
    )
```

`backend/app/api/issues.py`:
```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import List, Optional
from app.database import get_db
from app.models import Issue
from app.schemas.issue import IssueCreate, IssueOut, NextIssueInfo
from app.services.issue_service import get_next_issue_info, create_issue_with_data

router = APIRouter(prefix="/api/issues", tags=["issues"])


@router.get("", response_model=List[IssueOut])
def list_issues(skip: int = 0, limit: int = 20, db: Session = Depends(get_db)):
    return db.query(Issue).order_by(desc(Issue.issue_number)).offset(skip).limit(limit).all()


@router.get("/next", response_model=Optional[NextIssueInfo])
def next_issue(db: Session = Depends(get_db)):
    info = get_next_issue_info(db)
    if not info:
        raise HTTPException(status_code=404, detail="No upcoming issues found in schedule")
    return info


@router.post("", response_model=IssueOut, status_code=201)
def create_issue(data: IssueCreate, db: Session = Depends(get_db)):
    existing = db.query(Issue).filter(Issue.issue_number == data.issue_number).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Issue {data.issue_number} already exists")
    return create_issue_with_data(db, data.issue_number, data.publish_date, data.notes)


@router.get("/{issue_id}", response_model=IssueOut)
def get_issue(issue_id: int, db: Session = Depends(get_db)):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    return issue
```

- [ ] **Step 4: Register routers in `backend/app/main.py`**

Add these imports and registrations:

```python
from app.api.schedule import router as schedule_router
from app.api.issues import router as issues_router

app.include_router(schedule_router)
app.include_router(issues_router)
```

- [ ] **Step 5: Test APIs manually**

```bash
# Get schedule
curl http://localhost:8000/api/schedule

# Get next issue
curl http://localhost:8000/api/issues/next

# Create issue
curl -X POST http://localhost:8000/api/issues -H "Content-Type: application/json" -d "{\"issue_number\": 2649, \"publish_date\": \"2026-04-27\"}"
```

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/ backend/app/api/ backend/app/services/ backend/app/main.py
git commit -m "feat: add publication schedule and issues API"
```

---

### Task 6: Report Entries API

**Files:**
- Create: `backend/app/schemas/report.py`
- Create: `backend/app/api/reports.py`
- Modify: `backend/app/main.py` (register router)

- [ ] **Step 1: Create `backend/app/schemas/report.py`**

```python
from pydantic import BaseModel
from typing import List, Optional


class ReportEntryOut(BaseModel):
    id: int
    category: str
    sub_category: str
    value: int
    is_variable: bool

    model_config = {"from_attributes": True}


class ReportEntryUpdate(BaseModel):
    category: str
    sub_category: str
    value: int


class ReportDataOut(BaseModel):
    issue_id: int
    issue_number: int
    entries: List[ReportEntryOut]
    total: int


class ReportDataUpdate(BaseModel):
    entries: List[ReportEntryUpdate]


class ValidationWarning(BaseModel):
    field: str
    message: str
    level: str  # "warning" or "error"
```

- [ ] **Step 2: Create `backend/app/api/reports.py`**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models import Issue, ReportEntry, IssueStatus
from app.schemas.report import ReportDataOut, ReportDataUpdate, ReportEntryOut, ValidationWarning

router = APIRouter(prefix="/api/issues/{issue_id}/report", tags=["reports"])


@router.get("", response_model=ReportDataOut)
def get_report(issue_id: int, db: Session = Depends(get_db)):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    entries = (
        db.query(ReportEntry)
        .filter(ReportEntry.issue_id == issue_id)
        .order_by(ReportEntry.category, ReportEntry.id)
        .all()
    )
    total = sum(e.value for e in entries)
    return ReportDataOut(
        issue_id=issue.id,
        issue_number=issue.issue_number,
        entries=[ReportEntryOut.model_validate(e) for e in entries],
        total=total,
    )


@router.put("")
def update_report(issue_id: int, data: ReportDataUpdate, db: Session = Depends(get_db)):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    for entry_data in data.entries:
        entry = (
            db.query(ReportEntry)
            .filter(
                ReportEntry.issue_id == issue_id,
                ReportEntry.category == entry_data.category,
                ReportEntry.sub_category == entry_data.sub_category,
            )
            .first()
        )
        if entry:
            entry.value = entry_data.value

    db.commit()
    return {"message": "Report updated"}


@router.post("/confirm")
def confirm_report(issue_id: int, db: Session = Depends(get_db)):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    # Validation
    entries = db.query(ReportEntry).filter(ReportEntry.issue_id == issue_id).all()
    errors = []
    for e in entries:
        if e.is_variable and e.value is None:
            errors.append({"field": f"{e.category}/{e.sub_category}", "message": "必填变动项为空", "level": "error"})
        if e.value is not None and e.value < 0:
            errors.append({"field": f"{e.category}/{e.sub_category}", "message": "数值不能为负数", "level": "error"})

    if errors:
        raise HTTPException(status_code=422, detail=errors)

    issue.status = IssueStatus.confirmed
    db.commit()
    return {"message": "Report confirmed", "issue_number": issue.issue_number}
```

- [ ] **Step 3: Register router in `backend/app/main.py`**

```python
from app.api.reports import router as reports_router
app.include_router(reports_router)
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/schemas/report.py backend/app/api/reports.py backend/app/main.py
git commit -m "feat: add report entries API with validation"
```

---

### Task 7: Recipients & Subscriptions API

**Files:**
- Create: `backend/app/schemas/recipient.py`
- Create: `backend/app/api/recipients.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Create `backend/app/schemas/recipient.py`**

```python
from pydantic import BaseModel
from datetime import date, datetime
from typing import Optional, List
from app.models.recipient import RecipientType, RecipientFrequency, RecipientStatus
from app.models.subscription import SubscriptionType


class RecipientCreate(BaseModel):
    name: str
    phone: Optional[str] = None
    province: Optional[str] = None
    city: Optional[str] = None
    address: Optional[str] = None
    type: RecipientType
    frequency: RecipientFrequency = RecipientFrequency.weekly
    notes: Optional[str] = None


class RecipientUpdate(RecipientCreate):
    pass


class RecipientOut(BaseModel):
    id: int
    name: str
    phone: Optional[str]
    province: Optional[str]
    city: Optional[str]
    address: Optional[str]
    type: RecipientType
    frequency: RecipientFrequency
    status: RecipientStatus
    notes: Optional[str]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]
    active_subscription_end: Optional[date] = None

    model_config = {"from_attributes": True}


class SubscriptionCreate(BaseModel):
    type: SubscriptionType
    start_date: date
    end_date: date
    duration_months: Optional[int] = None
    quantity: int = 1
    notes: Optional[str] = None


class SubscriptionOut(BaseModel):
    id: int
    recipient_id: int
    type: SubscriptionType
    start_date: date
    end_date: date
    duration_months: Optional[int]
    quantity: int
    notes: Optional[str]
    created_at: Optional[datetime]

    model_config = {"from_attributes": True}


class StatusUpdate(BaseModel):
    status: RecipientStatus
```

- [ ] **Step 2: Create `backend/app/api/recipients.py`**

```python
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
from typing import List, Optional
from datetime import date
from app.database import get_db
from app.models import Recipient, Subscription, RecipientStatus
from app.schemas.recipient import (
    RecipientCreate, RecipientUpdate, RecipientOut,
    SubscriptionCreate, SubscriptionOut, StatusUpdate,
)

router = APIRouter(prefix="/api/recipients", tags=["recipients"])


def _enrich_recipient(recipient: Recipient, db: Session) -> RecipientOut:
    """Add active_subscription_end to recipient output."""
    latest_sub = (
        db.query(Subscription)
        .filter(Subscription.recipient_id == recipient.id, Subscription.end_date >= date.today())
        .order_by(desc(Subscription.end_date))
        .first()
    )
    out = RecipientOut.model_validate(recipient)
    out.active_subscription_end = latest_sub.end_date if latest_sub else None
    return out


@router.get("", response_model=List[RecipientOut])
def list_recipients(
    type: Optional[str] = None,
    frequency: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    query = db.query(Recipient)
    if type:
        query = query.filter(Recipient.type == type)
    if frequency:
        query = query.filter(Recipient.frequency == frequency)
    if status:
        query = query.filter(Recipient.status == status)
    if search:
        query = query.filter(Recipient.name.contains(search))
    recipients = query.order_by(Recipient.id).offset(skip).limit(limit).all()
    return [_enrich_recipient(r, db) for r in recipients]


@router.post("", response_model=RecipientOut, status_code=201)
def create_recipient(data: RecipientCreate, db: Session = Depends(get_db)):
    recipient = Recipient(**data.model_dump())
    db.add(recipient)
    db.commit()
    db.refresh(recipient)
    return _enrich_recipient(recipient, db)


@router.put("/{recipient_id}", response_model=RecipientOut)
def update_recipient(recipient_id: int, data: RecipientUpdate, db: Session = Depends(get_db)):
    recipient = db.query(Recipient).filter(Recipient.id == recipient_id).first()
    if not recipient:
        raise HTTPException(status_code=404, detail="Recipient not found")
    for key, value in data.model_dump().items():
        setattr(recipient, key, value)
    db.commit()
    db.refresh(recipient)
    return _enrich_recipient(recipient, db)


@router.patch("/{recipient_id}/status", response_model=RecipientOut)
def update_status(recipient_id: int, data: StatusUpdate, db: Session = Depends(get_db)):
    recipient = db.query(Recipient).filter(Recipient.id == recipient_id).first()
    if not recipient:
        raise HTTPException(status_code=404, detail="Recipient not found")
    recipient.status = data.status
    db.commit()
    db.refresh(recipient)
    return _enrich_recipient(recipient, db)


# --- Subscriptions ---

@router.get("/{recipient_id}/subscriptions", response_model=List[SubscriptionOut])
def list_subscriptions(recipient_id: int, db: Session = Depends(get_db)):
    return (
        db.query(Subscription)
        .filter(Subscription.recipient_id == recipient_id)
        .order_by(desc(Subscription.created_at))
        .all()
    )


@router.post("/{recipient_id}/subscriptions", response_model=SubscriptionOut, status_code=201)
def create_subscription(recipient_id: int, data: SubscriptionCreate, db: Session = Depends(get_db)):
    recipient = db.query(Recipient).filter(Recipient.id == recipient_id).first()
    if not recipient:
        raise HTTPException(status_code=404, detail="Recipient not found")

    sub = Subscription(recipient_id=recipient_id, **data.model_dump())
    db.add(sub)

    # Auto-activate if subscription is current
    if data.start_date <= date.today() <= data.end_date:
        recipient.status = RecipientStatus.active

    db.commit()
    db.refresh(sub)
    return sub
```

- [ ] **Step 3: Register router in `backend/app/main.py`**

```python
from app.api.recipients import router as recipients_router
app.include_router(recipients_router)
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/schemas/recipient.py backend/app/api/recipients.py backend/app/main.py
git commit -m "feat: add recipients and subscriptions API"
```

---

### Task 8: Shipping API

**Files:**
- Create: `backend/app/schemas/shipping.py`
- Create: `backend/app/services/shipping_service.py`
- Create: `backend/app/api/shipping.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Create `backend/app/schemas/shipping.py`**

```python
from pydantic import BaseModel
from typing import List, Optional
from app.models.shipping_record import ShippingStatus


class ShippingRecordOut(BaseModel):
    id: int
    issue_id: int
    recipient_id: int
    recipient_name: str
    recipient_address: Optional[str]
    recipient_phone: Optional[str]
    recipient_type: str
    quantity: int
    status: ShippingStatus

    model_config = {"from_attributes": True}


class ShippingRecordUpdate(BaseModel):
    recipient_id: int
    quantity: int


class ShippingDataUpdate(BaseModel):
    records: List[ShippingRecordUpdate]
```

- [ ] **Step 2: Create `backend/app/services/shipping_service.py`**

```python
from datetime import date
from sqlalchemy.orm import Session
from sqlalchemy import desc
from app.models import (
    Issue, Recipient, Subscription, ShippingRecord,
    RecipientStatus, PublicationSchedule,
)


def is_last_issue_of_month(publish_date: date, db: Session) -> bool:
    """Check if this is the last issue published in its month."""
    next_in_month = (
        db.query(PublicationSchedule)
        .filter(
            PublicationSchedule.publish_date > publish_date,
            PublicationSchedule.is_suspended == False,
        )
        .order_by(PublicationSchedule.publish_date.asc())
        .first()
    )
    if not next_in_month:
        return True
    return next_in_month.publish_date.month != publish_date.month


def should_ship_to_recipient(
    recipient: Recipient,
    issue: Issue,
    db: Session,
) -> bool:
    """Determine if a recipient should receive this issue."""
    # 1. Manual suspension overrides everything
    if recipient.status == RecipientStatus.suspended:
        return False

    # 2. Check active subscription
    latest_sub = (
        db.query(Subscription)
        .filter(
            Subscription.recipient_id == recipient.id,
            Subscription.end_date >= issue.publish_date,
            Subscription.start_date <= issue.publish_date,
        )
        .order_by(desc(Subscription.end_date))
        .first()
    )

    # For sample type, no subscription needed
    if recipient.type.value == "sample":
        pass  # always ship if active
    elif not latest_sub:
        return False

    # 3. Frequency check
    if recipient.frequency.value == "weekly":
        return True
    elif recipient.frequency.value == "biweekly":
        return issue.issue_number % 2 == 0
    elif recipient.frequency.value == "monthly":
        return is_last_issue_of_month(issue.publish_date, db)

    return True


def generate_shipping_records(issue_id: int, db: Session) -> list:
    """Generate shipping records for all eligible recipients."""
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        return []

    # Remove existing pending records (keep shipped ones)
    db.query(ShippingRecord).filter(
        ShippingRecord.issue_id == issue_id,
        ShippingRecord.status == "pending",
    ).delete()

    recipients = db.query(Recipient).all()
    records = []

    for recipient in recipients:
        if should_ship_to_recipient(recipient, issue, db):
            # Get quantity from latest subscription or default to 1
            latest_sub = (
                db.query(Subscription)
                .filter(
                    Subscription.recipient_id == recipient.id,
                    Subscription.end_date >= issue.publish_date,
                )
                .order_by(desc(Subscription.end_date))
                .first()
            )
            quantity = latest_sub.quantity if latest_sub else 1

            record = ShippingRecord(
                issue_id=issue_id,
                recipient_id=recipient.id,
                quantity=quantity,
            )
            db.add(record)
            records.append(record)

    db.commit()
    return records
```

- [ ] **Step 3: Create `backend/app/api/shipping.py`**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models import Issue, ShippingRecord, Recipient
from app.schemas.shipping import ShippingRecordOut, ShippingDataUpdate
from app.services.shipping_service import generate_shipping_records

router = APIRouter(prefix="/api/issues/{issue_id}/shipping", tags=["shipping"])


def _to_out(record: ShippingRecord, db: Session) -> ShippingRecordOut:
    recipient = db.query(Recipient).filter(Recipient.id == record.recipient_id).first()
    return ShippingRecordOut(
        id=record.id,
        issue_id=record.issue_id,
        recipient_id=record.recipient_id,
        recipient_name=recipient.name if recipient else "",
        recipient_address=recipient.address if recipient else None,
        recipient_phone=recipient.phone if recipient else None,
        recipient_type=recipient.type.value if recipient else "",
        quantity=record.quantity,
        status=record.status,
    )


@router.get("", response_model=List[ShippingRecordOut])
def get_shipping(issue_id: int, db: Session = Depends(get_db)):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    records = db.query(ShippingRecord).filter(ShippingRecord.issue_id == issue_id).all()
    if not records:
        records = generate_shipping_records(issue_id, db)

    return [_to_out(r, db) for r in records]


@router.put("")
def update_shipping(issue_id: int, data: ShippingDataUpdate, db: Session = Depends(get_db)):
    for item in data.records:
        record = (
            db.query(ShippingRecord)
            .filter(ShippingRecord.issue_id == issue_id, ShippingRecord.recipient_id == item.recipient_id)
            .first()
        )
        if record:
            record.quantity = item.quantity
    db.commit()
    return {"message": "Shipping records updated"}


@router.post("/regenerate", response_model=List[ShippingRecordOut])
def regenerate_shipping(issue_id: int, db: Session = Depends(get_db)):
    records = generate_shipping_records(issue_id, db)
    return [_to_out(r, db) for r in records]
```

- [ ] **Step 4: Register router and commit**

Add to `main.py`:
```python
from app.api.shipping import router as shipping_router
app.include_router(shipping_router)
```

```bash
git add backend/app/schemas/shipping.py backend/app/services/shipping_service.py backend/app/api/shipping.py backend/app/main.py
git commit -m "feat: add shipping API with auto-generation logic"
```

---

### Task 9: Excel Export Service

**Files:**
- Create: `backend/app/services/excel_service.py`
- Create: `backend/app/api/exports.py`
- Create: `backend/app/templates/` (directory for Excel templates)
- Modify: `backend/app/main.py`

- [ ] **Step 1: Create `backend/app/templates/` directory**

```bash
mkdir backend/app/templates
```

Place the user's original Excel files here as templates. For now, create a `.gitkeep`:
```bash
touch backend/app/templates/.gitkeep
```

- [ ] **Step 2: Create `backend/app/services/excel_service.py`**

```python
import io
import os
from datetime import date
from openpyxl import load_workbook, Workbook
from sqlalchemy.orm import Session
from app.models import Issue, ReportEntry, ReportItemTemplate, ShippingRecord, Recipient

TEMPLATE_DIR = os.path.join(os.path.dirname(__file__), "..", "templates")


def _get_template_path(filename: str) -> str:
    path = os.path.join(TEMPLATE_DIR, filename)
    if os.path.exists(path):
        return path
    return None


def export_report_excel(issue_id: int, db: Session) -> io.BytesIO:
    """Generate the 报数 Excel file for a given issue."""
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise ValueError("Issue not found")

    template_path = _get_template_path("report_template.xlsx")

    if template_path:
        wb = load_workbook(template_path)
    else:
        wb = Workbook()
        wb.active.title = "北京印厂印数表"

    # Get all entries with their template mappings
    entries = db.query(ReportEntry).filter(ReportEntry.issue_id == issue_id).all()
    templates = {
        (t.category, t.sub_category): t
        for t in db.query(ReportItemTemplate).all()
    }

    # Write data to mapped cells
    for entry in entries:
        tmpl = templates.get((entry.category, entry.sub_category))
        if tmpl and tmpl.excel_sheet and tmpl.excel_cell:
            if tmpl.excel_sheet in wb.sheetnames:
                ws = wb[tmpl.excel_sheet]
                ws[tmpl.excel_cell] = entry.value

    # Save to BytesIO
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    return output


def export_shipping_excel(issue_id: int, db: Session) -> io.BytesIO:
    """Generate the 中通发货明细 Excel file for a given issue."""
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise ValueError("Issue not found")

    template_path = _get_template_path("shipping_template.xlsx")

    if template_path:
        wb = load_workbook(template_path)
    else:
        wb = Workbook()

    # Get shipping records with recipient info
    records = (
        db.query(ShippingRecord, Recipient)
        .join(Recipient, ShippingRecord.recipient_id == Recipient.id)
        .filter(ShippingRecord.issue_id == issue_id)
        .all()
    )

    # Group by recipient type for different sheets
    corporate = [(r, rec) for r, rec in records if rec.type.value == "corporate"]
    readers = [(r, rec) for r, rec in records if rec.type.value == "reader"]
    samples = [(r, rec) for r, rec in records if rec.type.value == "sample"]

    def _write_sheet(ws, items, start_row=2):
        for i, (record, recipient) in enumerate(items):
            row = start_row + i
            ws.cell(row=row, column=1, value=i + 1)
            ws.cell(row=row, column=2, value=recipient.name)
            ws.cell(row=row, column=3, value=recipient.phone or "")
            ws.cell(row=row, column=4, value=recipient.address or "")
            ws.cell(row=row, column=5, value=record.quantity)

    # Write to sheets (create if template doesn't have them)
    sheet_names = ["每周合计", "每周（对公）", "每周（读者）", "样报缴送清单"]
    sheet_data = [corporate + readers + samples, corporate, readers, samples]

    for name, data in zip(sheet_names, sheet_data):
        if name in wb.sheetnames:
            ws = wb[name]
        else:
            ws = wb.create_sheet(name)
            ws.append(["序号", "收件人", "电话", "地址", "份数"])
        _write_sheet(ws, data)

    # Remove default "Sheet" if it exists and we created other sheets
    if "Sheet" in wb.sheetnames and len(wb.sheetnames) > 1:
        del wb["Sheet"]

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    return output


def get_report_filename(issue: Issue) -> str:
    year = issue.publish_date.year
    # Calculate issue order within the year
    return f"{year}年《中国经营报》（总第{issue.issue_number}期）报数.xlsx"


def get_shipping_filename(issue: Issue) -> str:
    d = issue.publish_date
    return f"{d.year}年{d.month}月{d.day}日《中国经营报》中通快递发货明细（{issue.issue_number}）.xlsx"
```

- [ ] **Step 3: Create `backend/app/api/exports.py`**

```python
import io
import zipfile
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Issue
from app.services.excel_service import (
    export_report_excel, export_shipping_excel,
    get_report_filename, get_shipping_filename,
)

router = APIRouter(prefix="/api/issues/{issue_id}/export", tags=["export"])


@router.get("/report")
def export_report(issue_id: int, db: Session = Depends(get_db)):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    output = export_report_excel(issue_id, db)
    filename = get_report_filename(issue)
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"},
    )


@router.get("/shipping")
def export_shipping(issue_id: int, db: Session = Depends(get_db)):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    output = export_shipping_excel(issue_id, db)
    filename = get_shipping_filename(issue)
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"},
    )


@router.get("/all")
def export_all(issue_id: int, db: Session = Depends(get_db)):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    report_bytes = export_report_excel(issue_id, db)
    shipping_bytes = export_shipping_excel(issue_id, db)

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(get_report_filename(issue), report_bytes.read())
        zf.writestr(get_shipping_filename(issue), shipping_bytes.read())

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=issue_{issue.issue_number}.zip"},
    )
```

- [ ] **Step 4: Register router and commit**

Add to `main.py`:
```python
from app.api.exports import router as exports_router
app.include_router(exports_router)
```

```bash
git add backend/app/services/excel_service.py backend/app/api/exports.py backend/app/templates/ backend/app/main.py
git commit -m "feat: add Excel export service with template-driven generation"
```

---

## Phase 2: Frontend

### Task 10: Frontend Scaffolding

**Files:**
- Create: `frontend/` (Vite + React + TypeScript project)
- Create: `frontend/src/api/client.ts`
- Modify: `frontend/vite.config.ts` (add API proxy)

- [ ] **Step 1: Create Vite project**

```bash
cd C:\Users\luyal\Repos\FirstTry
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
npm install antd @ant-design/icons axios dayjs
```

- [ ] **Step 2: Configure Vite proxy**

Edit `frontend/vite.config.ts`:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
```

- [ ] **Step 3: Create API client**

`frontend/src/api/client.ts`:
```typescript
import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

export default api;
```

- [ ] **Step 4: Set up basic App with routing**

```bash
npm install react-router-dom
```

`frontend/src/App.tsx`:
```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import AppLayout from './components/AppLayout';
import Dashboard from './pages/Dashboard';
import ReportEditor from './pages/ReportEditor';
import Recipients from './pages/Recipients';
import ShippingPreview from './pages/ShippingPreview';
import History from './pages/History';

function App() {
  return (
    <ConfigProvider locale={zhCN}>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/report/:issueId" element={<ReportEditor />} />
            <Route path="/recipients" element={<Recipients />} />
            <Route path="/shipping/:issueId" element={<ShippingPreview />} />
            <Route path="/history" element={<History />} />
          </Route>
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
}

export default App;
```

- [ ] **Step 5: Create AppLayout**

`frontend/src/components/AppLayout.tsx`:
```tsx
import { Layout, Menu } from 'antd';
import {
  DashboardOutlined,
  FormOutlined,
  TeamOutlined,
  HistoryOutlined,
} from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';

const { Header, Sider, Content } = Layout;

const menuItems = [
  { key: '/', icon: <DashboardOutlined />, label: '首页' },
  { key: '/recipients', icon: <TeamOutlined />, label: '收件人管理' },
  { key: '/history', icon: <HistoryOutlined />, label: '历史记录' },
];

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider>
        <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 'bold', fontSize: 16 }}>
          中国经营报
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', fontSize: 18, fontWeight: 'bold' }}>
          印数报数系统
        </Header>
        <Content style={{ margin: 24, padding: 24, background: '#fff', borderRadius: 8 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
```

- [ ] **Step 6: Create placeholder pages**

Create each file with a minimal placeholder:

`frontend/src/pages/Dashboard.tsx`:
```tsx
export default function Dashboard() {
  return <div>Dashboard — 开发中</div>;
}
```

`frontend/src/pages/ReportEditor.tsx`:
```tsx
export default function ReportEditor() {
  return <div>ReportEditor — 开发中</div>;
}
```

`frontend/src/pages/Recipients.tsx`:
```tsx
export default function Recipients() {
  return <div>Recipients — 开发中</div>;
}
```

`frontend/src/pages/ShippingPreview.tsx`:
```tsx
export default function ShippingPreview() {
  return <div>ShippingPreview — 开发中</div>;
}
```

`frontend/src/pages/History.tsx`:
```tsx
export default function History() {
  return <div>History — 开发中</div>;
}
```

- [ ] **Step 7: Verify frontend starts**

```bash
cd frontend
npm run dev
```

Visit `http://localhost:5173` — should see layout with sidebar navigation.

- [ ] **Step 8: Commit**

```bash
git add frontend/
git commit -m "feat: frontend scaffolding with React + Vite + Ant Design + routing"
```

---

### Task 11: Dashboard Page

**Files:**
- Modify: `frontend/src/pages/Dashboard.tsx`
- Create: `frontend/src/api/issues.ts`

- [ ] **Step 1: Create `frontend/src/api/issues.ts`**

```typescript
import api from './client';

export interface Issue {
  id: number;
  issue_number: number;
  publish_date: string;
  status: 'draft' | 'confirmed' | 'exported';
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface NextIssueInfo {
  issue_number: number;
  publish_date: string;
  previous_issue_id: number | null;
}

export const getIssues = (skip = 0, limit = 20) =>
  api.get<Issue[]>('/issues', { params: { skip, limit } });

export const getNextIssue = () =>
  api.get<NextIssueInfo>('/issues/next');

export const createIssue = (data: { issue_number: number; publish_date: string }) =>
  api.post<Issue>('/issues', data);

export const getIssue = (id: number) =>
  api.get<Issue>(`/issues/${id}`);
```

- [ ] **Step 2: Implement Dashboard page**

`frontend/src/pages/Dashboard.tsx`:
```tsx
import { useState, useEffect } from 'react';
import { Card, Button, Row, Col, Statistic, Tag, List, Space, message } from 'antd';
import { PlusOutlined, EditOutlined, SendOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { getIssues, getNextIssue, createIssue, Issue, NextIssueInfo } from '../api/issues';
import dayjs from 'dayjs';

const statusColors = { draft: 'orange', confirmed: 'blue', exported: 'green' };
const statusLabels = { draft: '草稿', confirmed: '已确认', exported: '已导出' };

export default function Dashboard() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [nextIssue, setNextIssue] = useState<NextIssueInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const fetchData = async () => {
    try {
      const [issuesRes, nextRes] = await Promise.all([
        getIssues(0, 10),
        getNextIssue().catch(() => ({ data: null })),
      ]);
      setIssues(issuesRes.data);
      setNextIssue(nextRes.data);
    } catch {
      message.error('加载数据失败');
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleCreateIssue = async () => {
    if (!nextIssue) return;
    setLoading(true);
    try {
      const res = await createIssue({
        issue_number: nextIssue.issue_number,
        publish_date: nextIssue.publish_date,
      });
      message.success(`第 ${res.data.issue_number} 期已创建`);
      navigate(`/report/${res.data.id}`);
    } catch (err: any) {
      message.error(err.response?.data?.detail || '创建失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={8}>
          <Card>
            <Statistic title="下一期" value={nextIssue?.issue_number || '—'} />
            <p style={{ color: '#888', marginTop: 8 }}>
              {nextIssue ? dayjs(nextIssue.publish_date).format('YYYY年M月D日') : '无排期'}
            </p>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleCreateIssue}
              loading={loading}
              disabled={!nextIssue}
              style={{ marginTop: 8 }}
            >
              创建本期报数
            </Button>
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic title="已创建期数" value={issues.length} />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="待处理"
              value={issues.filter(i => i.status === 'draft').length}
              suffix="期"
            />
          </Card>
        </Col>
      </Row>

      <Card title="最近期数">
        <List
          dataSource={issues}
          renderItem={(item) => (
            <List.Item
              actions={[
                <Button
                  icon={<EditOutlined />}
                  onClick={() => navigate(`/report/${item.id}`)}
                >
                  编辑报数
                </Button>,
                <Button
                  icon={<SendOutlined />}
                  onClick={() => navigate(`/shipping/${item.id}`)}
                >
                  发货明细
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space>
                    <span>第 {item.issue_number} 期</span>
                    <Tag color={statusColors[item.status]}>{statusLabels[item.status]}</Tag>
                  </Space>
                }
                description={`出版日期：${dayjs(item.publish_date).format('YYYY-MM-DD')}`}
              />
            </List.Item>
          )}
        />
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/
git commit -m "feat: implement Dashboard page with issue creation"
```

---

### Task 12: Report Editor Page

**Files:**
- Create: `frontend/src/api/reports.ts`
- Modify: `frontend/src/pages/ReportEditor.tsx`

- [ ] **Step 1: Create `frontend/src/api/reports.ts`**

```typescript
import api from './client';

export interface ReportEntry {
  id: number;
  category: string;
  sub_category: string;
  value: number;
  is_variable: boolean;
}

export interface ReportData {
  issue_id: number;
  issue_number: number;
  entries: ReportEntry[];
  total: number;
}

export const getReport = (issueId: number) =>
  api.get<ReportData>(`/issues/${issueId}/report`);

export const updateReport = (issueId: number, entries: { category: string; sub_category: string; value: number }[]) =>
  api.put(`/issues/${issueId}/report`, { entries });

export const confirmReport = (issueId: number) =>
  api.post(`/issues/${issueId}/report/confirm`);
```

- [ ] **Step 2: Implement ReportEditor page**

`frontend/src/pages/ReportEditor.tsx`:
```tsx
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card, InputNumber, Button, Space, Tag, message, Spin, Divider, Statistic, Row, Col, Popconfirm,
} from 'antd';
import { SaveOutlined, CheckOutlined, DownloadOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { getReport, updateReport, confirmReport, ReportEntry } from '../api/reports';
import { getIssue } from '../api/issues';
import dayjs from 'dayjs';

const categoryLabels: Record<string, string> = {
  postal: '📮 北京邮发',
  retail: '🏪 北京报零',
  guangzhou: '🌆 广州日报',
  social_use: '🏢 社用报',
  temp: '📋 临时加印',
  other: '📦 其他',
};

export default function ReportEditor() {
  const { issueId } = useParams<{ issueId: string }>();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<ReportEntry[]>([]);
  const [issueInfo, setIssueInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!issueId) return;
    Promise.all([getReport(Number(issueId)), getIssue(Number(issueId))])
      .then(([reportRes, issueRes]) => {
        setEntries(reportRes.data.entries);
        setIssueInfo(issueRes.data);
      })
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  }, [issueId]);

  const handleValueChange = (index: number, value: number | null) => {
    const updated = [...entries];
    updated[index] = { ...updated[index], value: value ?? 0 };
    setEntries(updated);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateReport(Number(issueId), entries.map(e => ({
        category: e.category,
        sub_category: e.sub_category,
        value: e.value,
      })));
      message.success('已保存');
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirm = async () => {
    try {
      await handleSave();
      await confirmReport(Number(issueId));
      message.success('报数已确认');
      navigate('/');
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      if (Array.isArray(detail)) {
        detail.forEach((d: any) => message.error(`${d.field}: ${d.message}`));
      } else {
        message.error('确认失败');
      }
    }
  };

  const handleExport = () => {
    window.open(`/api/issues/${issueId}/export/report`, '_blank');
  };

  const total = entries.reduce((sum, e) => sum + (e.value || 0), 0);

  // Group entries by category
  const grouped = entries.reduce((acc, entry, index) => {
    if (!acc[entry.category]) acc[entry.category] = [];
    acc[entry.category].push({ ...entry, _index: index });
    return acc;
  }, {} as Record<string, (ReportEntry & { _index: number })[]>);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>返回</Button>
        <span style={{ fontSize: 18, fontWeight: 'bold' }}>
          第 {issueInfo?.issue_number} 期报数编辑
        </span>
        <Tag>{dayjs(issueInfo?.publish_date).format('YYYY-MM-DD')}</Tag>
      </Space>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card><Statistic title="总印数" value={total} /></Card></Col>
        <Col span={6}><Card><Statistic title="变动项" value={entries.filter(e => e.is_variable).length} /></Card></Col>
        <Col span={12} style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
          <Button icon={<SaveOutlined />} onClick={handleSave} loading={saving}>保存草稿</Button>
          <Popconfirm title="确认报数数据无误？" onConfirm={handleConfirm}>
            <Button type="primary" icon={<CheckOutlined />}>确认报数</Button>
          </Popconfirm>
          <Button icon={<DownloadOutlined />} onClick={handleExport}>导出 Excel</Button>
        </Col>
      </Row>

      {Object.entries(grouped).map(([category, items]) => (
        <Card
          key={category}
          title={categoryLabels[category] || category}
          size="small"
          style={{ marginBottom: 16 }}
        >
          {items.map((entry) => (
            <div key={entry.id} style={{
              display: 'flex', alignItems: 'center', padding: '6px 0',
              borderBottom: '1px solid #f0f0f0',
              background: entry.is_variable ? 'rgba(255, 159, 67, 0.06)' : 'transparent',
            }}>
              <span style={{ width: 200 }}>
                {entry.sub_category}
                {entry.is_variable && <Tag color="orange" style={{ marginLeft: 8 }}>变动</Tag>}
              </span>
              <InputNumber
                value={entry.value}
                onChange={(v) => handleValueChange(entry._index, v)}
                min={0}
                style={{ width: 120 }}
                disabled={!entry.is_variable && issueInfo?.status !== 'draft'}
              />
            </div>
          ))}
          <Divider style={{ margin: '8px 0' }} />
          <div style={{ textAlign: 'right', fontWeight: 'bold' }}>
            小计：{items.reduce((s, e) => s + (e.value || 0), 0)}
          </div>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/
git commit -m "feat: implement Report Editor page with variable field highlighting"
```

---

### Task 13: Recipients Management Page

**Files:**
- Create: `frontend/src/api/recipients.ts`
- Modify: `frontend/src/pages/Recipients.tsx`

- [ ] **Step 1: Create `frontend/src/api/recipients.ts`**

```typescript
import api from './client';

export interface Recipient {
  id: number;
  name: string;
  phone: string | null;
  province: string | null;
  city: string | null;
  address: string | null;
  type: 'corporate' | 'reader' | 'sample';
  frequency: 'weekly' | 'biweekly' | 'monthly';
  status: 'active' | 'suspended';
  notes: string | null;
  active_subscription_end: string | null;
  created_at: string;
}

export interface Subscription {
  id: number;
  recipient_id: number;
  type: 'new' | 'renewal';
  start_date: string;
  end_date: string;
  duration_months: number | null;
  quantity: number;
  notes: string | null;
  created_at: string;
}

export const getRecipients = (params?: Record<string, any>) =>
  api.get<Recipient[]>('/recipients', { params });

export const createRecipient = (data: Partial<Recipient>) =>
  api.post<Recipient>('/recipients', data);

export const updateRecipient = (id: number, data: Partial<Recipient>) =>
  api.put<Recipient>(`/recipients/${id}`, data);

export const updateRecipientStatus = (id: number, status: string) =>
  api.patch<Recipient>(`/recipients/${id}/status`, { status });

export const getSubscriptions = (recipientId: number) =>
  api.get<Subscription[]>(`/recipients/${recipientId}/subscriptions`);

export const createSubscription = (recipientId: number, data: Partial<Subscription>) =>
  api.post<Subscription>(`/recipients/${recipientId}/subscriptions`, data);
```

- [ ] **Step 2: Implement Recipients page**

`frontend/src/pages/Recipients.tsx`:
```tsx
import { useState, useEffect } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, Tag, Space, message, DatePicker, InputNumber, Drawer,
  Timeline, Popconfirm,
} from 'antd';
import { PlusOutlined, StopOutlined, PlayCircleOutlined } from '@ant-design/icons';
import {
  getRecipients, createRecipient, updateRecipient, updateRecipientStatus,
  getSubscriptions, createSubscription, Recipient, Subscription,
} from '../api/recipients';
import dayjs from 'dayjs';

const typeLabels = { corporate: '对公', reader: '读者', sample: '样报' };
const typeColors = { corporate: 'blue', reader: 'green', sample: 'purple' };
const freqLabels = { weekly: '每周', biweekly: '双周', monthly: '月底' };

export default function Recipients() {
  const [data, setData] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Recipient | null>(null);
  const [subDrawer, setSubDrawer] = useState<Recipient | null>(null);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [subModalOpen, setSubModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [subForm] = Form.useForm();
  const [filters, setFilters] = useState<Record<string, string>>({});

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await getRecipients(filters);
      setData(res.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [filters]);

  const handleSave = async (values: any) => {
    try {
      if (editing) {
        await updateRecipient(editing.id, values);
        message.success('更新成功');
      } else {
        await createRecipient(values);
        message.success('创建成功');
      }
      setModalOpen(false);
      form.resetFields();
      setEditing(null);
      fetchData();
    } catch {
      message.error('操作失败');
    }
  };

  const handleToggleStatus = async (r: Recipient) => {
    const newStatus = r.status === 'active' ? 'suspended' : 'active';
    await updateRecipientStatus(r.id, newStatus);
    message.success(newStatus === 'suspended' ? '已停发' : '已恢复');
    fetchData();
  };

  const openSubscriptions = async (r: Recipient) => {
    setSubDrawer(r);
    const res = await getSubscriptions(r.id);
    setSubs(res.data);
  };

  const handleAddSub = async (values: any) => {
    if (!subDrawer) return;
    await createSubscription(subDrawer.id, {
      ...values,
      start_date: values.start_date.format('YYYY-MM-DD'),
      end_date: values.end_date.format('YYYY-MM-DD'),
    });
    message.success('订阅已添加');
    setSubModalOpen(false);
    subForm.resetFields();
    const res = await getSubscriptions(subDrawer.id);
    setSubs(res.data);
    fetchData();
  };

  const columns = [
    { title: '姓名', dataIndex: 'name', key: 'name' },
    { title: '类型', dataIndex: 'type', key: 'type',
      render: (t: string) => <Tag color={typeColors[t as keyof typeof typeColors]}>{typeLabels[t as keyof typeof typeLabels]}</Tag>,
    },
    { title: '频率', dataIndex: 'frequency', key: 'frequency',
      render: (f: string) => freqLabels[f as keyof typeof freqLabels],
    },
    { title: '状态', dataIndex: 'status', key: 'status',
      render: (s: string) => <Tag color={s === 'active' ? 'green' : 'red'}>{s === 'active' ? '在发' : '停发'}</Tag>,
    },
    { title: '订阅截止', dataIndex: 'active_subscription_end', key: 'sub_end',
      render: (d: string | null) => d ? dayjs(d).format('YYYY-MM-DD') : '—',
    },
    { title: '电话', dataIndex: 'phone', key: 'phone' },
    { title: '操作', key: 'action',
      render: (_: any, r: Recipient) => (
        <Space>
          <Button size="small" onClick={() => { setEditing(r); form.setFieldsValue(r); setModalOpen(true); }}>编辑</Button>
          <Button size="small" onClick={() => openSubscriptions(r)}>订阅</Button>
          <Popconfirm title={`确认${r.status === 'active' ? '停发' : '恢复'}？`} onConfirm={() => handleToggleStatus(r)}>
            <Button size="small" danger={r.status === 'active'} icon={r.status === 'active' ? <StopOutlined /> : <PlayCircleOutlined />}>
              {r.status === 'active' ? '停发' : '恢复'}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Select placeholder="类型" allowClear style={{ width: 100 }} onChange={v => setFilters(f => ({ ...f, type: v }))}>
          <Select.Option value="corporate">对公</Select.Option>
          <Select.Option value="reader">读者</Select.Option>
          <Select.Option value="sample">样报</Select.Option>
        </Select>
        <Select placeholder="状态" allowClear style={{ width: 100 }} onChange={v => setFilters(f => ({ ...f, status: v }))}>
          <Select.Option value="active">在发</Select.Option>
          <Select.Option value="suspended">停发</Select.Option>
        </Select>
        <Input.Search placeholder="搜索姓名" onSearch={v => setFilters(f => ({ ...f, search: v }))} style={{ width: 200 }} />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); form.resetFields(); setModalOpen(true); }}>
          新增收件人
        </Button>
      </Space>

      <Table dataSource={data} columns={columns} rowKey="id" loading={loading} size="small" />

      {/* Create/Edit Modal */}
      <Modal title={editing ? '编辑收件人' : '新增收件人'} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => form.submit()}>
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item name="name" label="姓名" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="phone" label="电话"><Input /></Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="corporate">对公</Select.Option>
              <Select.Option value="reader">读者</Select.Option>
              <Select.Option value="sample">样报</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="frequency" label="发送频率" initialValue="weekly">
            <Select>
              <Select.Option value="weekly">每周</Select.Option>
              <Select.Option value="biweekly">双周</Select.Option>
              <Select.Option value="monthly">月底</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="province" label="省份"><Input /></Form.Item>
          <Form.Item name="city" label="城市"><Input /></Form.Item>
          <Form.Item name="address" label="地址"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="notes" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      {/* Subscriptions Drawer */}
      <Drawer title={`${subDrawer?.name} — 订阅记录`} open={!!subDrawer} onClose={() => setSubDrawer(null)} width={480}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { subForm.resetFields(); setSubModalOpen(true); }} style={{ marginBottom: 16 }}>
          新增订阅/续订
        </Button>
        <Timeline
          items={subs.map(s => ({
            color: s.type === 'new' ? 'green' : 'blue',
            children: (
              <div>
                <Tag color={s.type === 'new' ? 'green' : 'blue'}>{s.type === 'new' ? '新订' : '续订'}</Tag>
                <span>{dayjs(s.start_date).format('YYYY-MM-DD')} ~ {dayjs(s.end_date).format('YYYY-MM-DD')}</span>
                <span style={{ marginLeft: 8 }}>({s.quantity}份)</span>
              </div>
            ),
          }))}
        />

        <Modal title="新增订阅" open={subModalOpen} onCancel={() => setSubModalOpen(false)} onOk={() => subForm.submit()}>
          <Form form={subForm} layout="vertical" onFinish={handleAddSub}>
            <Form.Item name="type" label="类型" rules={[{ required: true }]}>
              <Select>
                <Select.Option value="new">新订</Select.Option>
                <Select.Option value="renewal">续订</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item name="start_date" label="开始日期" rules={[{ required: true }]}><DatePicker /></Form.Item>
            <Form.Item name="end_date" label="截止日期" rules={[{ required: true }]}><DatePicker /></Form.Item>
            <Form.Item name="duration_months" label="订阅时长(月)"><InputNumber min={1} /></Form.Item>
            <Form.Item name="quantity" label="份数" initialValue={1} rules={[{ required: true }]}><InputNumber min={1} /></Form.Item>
            <Form.Item name="notes" label="备注"><Input.TextArea rows={2} /></Form.Item>
          </Form>
        </Modal>
      </Drawer>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/
git commit -m "feat: implement Recipients management with subscriptions"
```

---

### Task 14: Shipping Preview Page

**Files:**
- Create: `frontend/src/api/shipping.ts`
- Modify: `frontend/src/pages/ShippingPreview.tsx`

- [ ] **Step 1: Create `frontend/src/api/shipping.ts`**

```typescript
import api from './client';

export interface ShippingRecord {
  id: number;
  issue_id: number;
  recipient_id: number;
  recipient_name: string;
  recipient_address: string | null;
  recipient_phone: string | null;
  recipient_type: string;
  quantity: number;
  status: string;
}

export const getShipping = (issueId: number) =>
  api.get<ShippingRecord[]>(`/issues/${issueId}/shipping`);

export const regenerateShipping = (issueId: number) =>
  api.post<ShippingRecord[]>(`/issues/${issueId}/shipping/regenerate`);
```

- [ ] **Step 2: Implement ShippingPreview page**

`frontend/src/pages/ShippingPreview.tsx`:
```tsx
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Table, Tabs, Button, Space, Tag, message, Spin, Statistic, Row, Col, Card } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined, DownloadOutlined } from '@ant-design/icons';
import { getShipping, regenerateShipping, ShippingRecord } from '../api/shipping';
import { getIssue } from '../api/issues';

const typeLabels: Record<string, string> = {
  corporate: '对公', reader: '读者', sample: '样报',
};

export default function ShippingPreview() {
  const { issueId } = useParams<{ issueId: string }>();
  const navigate = useNavigate();
  const [records, setRecords] = useState<ShippingRecord[]>([]);
  const [issueInfo, setIssueInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [shippingRes, issueRes] = await Promise.all([
        getShipping(Number(issueId)),
        getIssue(Number(issueId)),
      ]);
      setRecords(shippingRes.data);
      setIssueInfo(issueRes.data);
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [issueId]);

  const handleRegenerate = async () => {
    setLoading(true);
    try {
      const res = await regenerateShipping(Number(issueId));
      setRecords(res.data);
      message.success('发货明细已重新生成');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => {
    window.open(`/api/issues/${issueId}/export/shipping`, '_blank');
  };

  const handleExportAll = () => {
    window.open(`/api/issues/${issueId}/export/all`, '_blank');
  };

  const columns = [
    { title: '序号', key: 'index', render: (_: any, __: any, i: number) => i + 1, width: 60 },
    { title: '收件人', dataIndex: 'recipient_name', key: 'name' },
    { title: '电话', dataIndex: 'recipient_phone', key: 'phone' },
    { title: '地址', dataIndex: 'recipient_address', key: 'address', ellipsis: true },
    { title: '份数', dataIndex: 'quantity', key: 'quantity', width: 80 },
    { title: '类型', dataIndex: 'recipient_type', key: 'type', width: 80,
      render: (t: string) => <Tag>{typeLabels[t] || t}</Tag>,
    },
  ];

  const grouped = {
    all: records,
    corporate: records.filter(r => r.recipient_type === 'corporate'),
    reader: records.filter(r => r.recipient_type === 'reader'),
    sample: records.filter(r => r.recipient_type === 'sample'),
  };

  const totalQty = records.reduce((s, r) => s + r.quantity, 0);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>返回</Button>
        <span style={{ fontSize: 18, fontWeight: 'bold' }}>
          第 {issueInfo?.issue_number} 期 — 发货明细
        </span>
      </Space>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card><Statistic title="总发货人数" value={records.length} /></Card></Col>
        <Col span={6}><Card><Statistic title="总份数" value={totalQty} /></Card></Col>
        <Col span={12} style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
          <Button icon={<ReloadOutlined />} onClick={handleRegenerate}>重新生成</Button>
          <Button icon={<DownloadOutlined />} onClick={handleExport}>导出发货明细</Button>
          <Button type="primary" icon={<DownloadOutlined />} onClick={handleExportAll}>导出全部</Button>
        </Col>
      </Row>

      <Tabs
        items={[
          { key: 'all', label: `全部 (${grouped.all.length})`, children: <Table dataSource={grouped.all} columns={columns} rowKey="id" size="small" /> },
          { key: 'corporate', label: `对公 (${grouped.corporate.length})`, children: <Table dataSource={grouped.corporate} columns={columns} rowKey="id" size="small" /> },
          { key: 'reader', label: `读者 (${grouped.reader.length})`, children: <Table dataSource={grouped.reader} columns={columns} rowKey="id" size="small" /> },
          { key: 'sample', label: `样报 (${grouped.sample.length})`, children: <Table dataSource={grouped.sample} columns={columns} rowKey="id" size="small" /> },
        ]}
      />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/
git commit -m "feat: implement Shipping Preview page with tab grouping"
```

---

### Task 15: History Page

**Files:**
- Modify: `frontend/src/pages/History.tsx`

- [ ] **Step 1: Implement History page**

`frontend/src/pages/History.tsx`:
```tsx
import { useState, useEffect } from 'react';
import { Table, Tag, Button, Space, message } from 'antd';
import { EditOutlined, SendOutlined, DownloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { getIssues, Issue } from '../api/issues';
import dayjs from 'dayjs';

const statusColors = { draft: 'orange', confirmed: 'blue', exported: 'green' };
const statusLabels = { draft: '草稿', confirmed: '已确认', exported: '已导出' };

export default function History() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    getIssues(0, 100).then(res => setIssues(res.data)).finally(() => setLoading(false));
  }, []);

  const columns = [
    { title: '期号', dataIndex: 'issue_number', key: 'issue_number', sorter: (a: Issue, b: Issue) => a.issue_number - b.issue_number },
    { title: '出版日期', dataIndex: 'publish_date', key: 'publish_date', render: (d: string) => dayjs(d).format('YYYY-MM-DD') },
    { title: '状态', dataIndex: 'status', key: 'status',
      render: (s: string) => <Tag color={statusColors[s as keyof typeof statusColors]}>{statusLabels[s as keyof typeof statusLabels]}</Tag>,
    },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', render: (d: string) => d ? dayjs(d).format('MM-DD HH:mm') : '—' },
    { title: '操作', key: 'action', render: (_: any, r: Issue) => (
      <Space>
        <Button size="small" icon={<EditOutlined />} onClick={() => navigate(`/report/${r.id}`)}>报数</Button>
        <Button size="small" icon={<SendOutlined />} onClick={() => navigate(`/shipping/${r.id}`)}>发货</Button>
        <Button size="small" icon={<DownloadOutlined />} onClick={() => window.open(`/api/issues/${r.id}/export/all`, '_blank')}>导出</Button>
      </Space>
    )},
  ];

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>历史期数</h2>
      <Table dataSource={issues} columns={columns} rowKey="id" loading={loading} size="small" />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/History.tsx
git commit -m "feat: implement History page"
```

---

## Phase 3: Integration & Documentation

### Task 16: Production Build Config

**Files:**
- Modify: `backend/app/main.py` (serve static files)

- [ ] **Step 1: Update `backend/app/main.py` to serve frontend in production**

Add at the bottom of `main.py`, after all router registrations:

```python
import os
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# Serve frontend static files in production
frontend_dist = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
if os.path.exists(frontend_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dist, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Catch-all route to serve React SPA for client-side routing."""
        file_path = os.path.join(frontend_dist, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(frontend_dist, "index.html"))
```

- [ ] **Step 2: Build frontend and test**

```bash
cd frontend
npm run build
cd ../backend
uvicorn app.main:app --port 8000
```

Visit `http://localhost:8000` — should serve the full app from single port.

- [ ] **Step 3: Commit**

```bash
git add backend/app/main.py
git commit -m "feat: serve React SPA from FastAPI in production mode"
```

---

### Task 17: Project Documentation

**Files:**
- Create: `docs/technical.md`
- Create: `docs/requirements.md`
- Create: `docs/user-guide.md`
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
# 中国经营报 · 印数报数系统

每周五生成下周一出版的《中国经营报》印数报数表和中通快递发货明细的 Web 应用。

## 技术栈
- **后端**: FastAPI + SQLAlchemy + openpyxl
- **前端**: React + TypeScript + Ant Design
- **数据库**: MySQL

## 快速开始

### 1. 环境准备
- Python 3.11+
- Node.js 18+
- MySQL 数据库

### 2. 配置
在项目根目录创建 `.env` 文件：
```env
MYSQL_HOST=your_host
MYSQL_PORT=3306
MYSQL_USER=your_user
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=your_database
```

### 3. 后端启动
```bash
cd backend
python -m venv venv
venv\Scripts\activate  # Windows
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

### 4. 前端启动（开发模式）
```bash
cd frontend
npm install
npm run dev
```

### 5. 生产部署
```bash
cd frontend && npm run build
cd ../backend && uvicorn app.main:app --port 8000
```
访问 `http://localhost:8000`

## 文档
- [技术文档](docs/technical.md)
- [需求文档](docs/requirements.md)
- [操作手册](docs/user-guide.md)
```

- [ ] **Step 2: Create `docs/technical.md`**

Technical documentation covering architecture, database schema, API reference, and deployment guide. Content should mirror the design spec sections 2, 3, 5, 6 with additional deployment instructions.

- [ ] **Step 3: Create `docs/requirements.md`**

Requirements documentation covering all functional requirements, data flow, validation rules, and edge cases. Content should mirror design spec sections 1, 4, 7, 8, 9.

- [ ] **Step 4: Create `docs/user-guide.md`**

User guide with step-by-step instructions for:
1. 首次使用（初始化种子数据、录入基础报数数据、导入收件人）
2. 每周操作流程（创建新期 → 输入变动数据 → 预览 → 导出）
3. 收件人管理（新增、续订、停发）
4. 常见问题（FAQ）

- [ ] **Step 5: Commit**

```bash
git add README.md docs/
git commit -m "docs: add technical docs, requirements, and user guide"
```

---

### Task 18: Seed Report Templates (Data Initialization)

**Files:**
- Create: `backend/app/seeds/report_templates.py`
- Modify: `backend/app/main.py` (add to seed endpoint)

- [ ] **Step 1: Create `backend/app/seeds/report_templates.py`**

Based on the data analysis from the previous session (issues 2643/2644), seed all known report items:

```python
from sqlalchemy.orm import Session
from app.models import ReportItemTemplate

TEMPLATES = [
    # (category, sub_category, display_name, default_value, is_variable, sort_order)
    ("postal", "外埠", "北京邮发-外埠", 5581, True, 10),
    ("postal", "本市", "北京邮发-本市", 1217, True, 20),
    ("retail", "东部", "北京报零-东部", 460, True, 30),
    ("retail", "西部", "北京报零-西部", 592, True, 40),
    ("guangzhou", "零售", "广州日报-零售", 500, True, 50),
    ("guangzhou", "订户", "广州日报-订户", 31, True, 60),
    ("other", "杂志铺", "杂志铺", 375, False, 70),
    ("other", "国图贸", "国图贸", 1, False, 80),
    ("other", "合订本", "合订本", 15, False, 90),
    ("temp", "临时加印", "临时加印", 0, True, 100),
    ("social_use", "营报传媒", "营报传媒", 183, True, 110),
    ("social_use", "新闻中心", "新闻中心", 45, False, 120),
    ("social_use", "财经中心", "财经中心", 9, True, 130),
    ("social_use", "行政", "行政", 4, False, 140),
    ("social_use", "出版中心", "出版中心", 10, False, 150),
    ("social_use", "上海站", "上海站用报", 10, False, 160),
    ("social_use", "广东站", "广东站用报", 30, False, 170),
    ("social_use", "西安站", "西安站用报", 10, False, 180),
    ("social_use", "备用报", "备用报（留存）", 71, True, 190),
    ("other", "上犹", "上犹", 30, False, 200),
]


def seed_report_templates(db: Session) -> int:
    existing = db.query(ReportItemTemplate).count()
    if existing > 0:
        return 0

    count = 0
    for cat, sub, display, default, is_var, sort in TEMPLATES:
        tmpl = ReportItemTemplate(
            category=cat,
            sub_category=sub,
            display_name=display,
            default_value=default,
            is_variable=is_var,
            sort_order=sort,
        )
        db.add(tmpl)
        count += 1

    db.commit()
    return count
```

**Note:** The `excel_sheet` and `excel_cell` fields are left empty for now. They will be populated once the user provides the original Excel templates to map exact cell positions.

- [ ] **Step 2: Update seed endpoint in `backend/app/main.py`**

```python
from app.seeds.report_templates import seed_report_templates

@app.post("/api/admin/seed")
def run_seeds():
    db = SessionLocal()
    try:
        schedule_count = seed_publication_schedule_2026(db)
        template_count = seed_report_templates(db)
        return {
            "message": f"Seeded {schedule_count} schedule entries, {template_count} report templates"
        }
    finally:
        db.close()
```

- [ ] **Step 3: Run seed and commit**

```bash
curl -X POST http://localhost:8000/api/admin/seed
```

```bash
git add backend/app/seeds/report_templates.py backend/app/main.py
git commit -m "feat: seed report item templates from analyzed data"
```

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| Phase 1 | Tasks 1-9 | Backend: scaffolding, models, migrations, seeds, all APIs, Excel export |
| Phase 2 | Tasks 10-15 | Frontend: scaffolding, Dashboard, ReportEditor, Recipients, Shipping, History |
| Phase 3 | Tasks 16-18 | Integration: production build, documentation, data initialization |

**Total: 18 tasks**

**Post-MVP items** (not in this plan):
- OCR for fax/image data
- Data trend charts
- Renewal rate analytics
- Expiration reminders
- CSV bulk import
- Remote server deployment
