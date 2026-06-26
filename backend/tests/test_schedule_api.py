"""Integration tests for the publication-schedule (期刊表) REST API.

In-memory SQLite + FastAPI TestClient with auth overridden, mirroring
test_products_api.py.
"""

import datetime
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("MYSQL_USER", "test")
os.environ.setdefault("MYSQL_PASSWORD", "test")
os.environ.setdefault("MYSQL_DATABASE", "test")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import get_current_user
from app.database import Base, get_db
from app.main import app
from app.models import PublicationSchedule
from app.models.user import User, UserRole


@pytest.fixture
def client_with_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    fake_user = User(id=1, username="tester", password_hash="x", role=UserRole.admin)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = lambda: fake_user

    c = TestClient(app)
    try:
        yield c, TestingSessionLocal
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)


def _seed_year(db, year, count=2):
    for i in range(count):
        db.add(
            PublicationSchedule(
                year=year,
                issue_number=1000 + i,
                publish_date=datetime.date(year, 1, 1 + i),
                is_suspended=False,
            )
        )
    db.commit()


def test_years_empty_when_no_schedule(client_with_db):
    client, _ = client_with_db
    r = client.get("/api/schedule/years")
    assert r.status_code == 200, r.text
    assert r.json() == []


def test_years_returns_distinct_sorted_years(client_with_db):
    client, SessionLocal = client_with_db
    db = SessionLocal()
    try:
        # Insert out of order, with multiple rows per year, incl. a historical year.
        _seed_year(db, 2026, count=3)
        _seed_year(db, 2024, count=2)
        _seed_year(db, 2025, count=2)
    finally:
        db.close()

    r = client.get("/api/schedule/years")
    assert r.status_code == 200, r.text
    # distinct (no dupes despite multiple rows) and ascending — 2024 must be present
    assert r.json() == [2024, 2025, 2026]
