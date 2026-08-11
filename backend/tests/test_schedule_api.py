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
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import get_current_user
from app.database import Base, get_db
from app.main import app
from app.models import Issue, PublicationSchedule, PublicationScheduleUpload, PublicationScheduleUploadStatus
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


def test_schedule_list_joins_actual_page_counts_in_one_select(client_with_db):
    client, SessionLocal = client_with_db
    db = SessionLocal()
    try:
        _seed_year(db, 2026, count=3)
        db.add(
            Issue(
                issue_number=1000,
                publish_date=datetime.date(2026, 1, 1),
                page_count=32,
            )
        )
        db.commit()
    finally:
        db.close()

    statements: list[str] = []
    engine = SessionLocal.kw["bind"]

    def capture_sql(_conn, _cursor, statement, _params, _context, _many):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture_sql)
    try:
        response = client.get("/api/schedule?year=2026")
    finally:
        event.remove(engine, "before_cursor_execute", capture_sql)

    assert response.status_code == 200
    assert response.json()[0]["actual_page_count"] == 32
    assert sum(sql.lstrip().upper().startswith("SELECT") for sql in statements) == 1


def test_listing_uploads_never_deletes_stale_previews(client_with_db):
    client, SessionLocal = client_with_db
    db = SessionLocal()
    try:
        db.add_all([
            PublicationScheduleUpload(
                year=2026,
                original_filename="committed.pdf",
                stored_path="/tmp/committed.pdf",
                status=PublicationScheduleUploadStatus.committed,
            ),
            PublicationScheduleUpload(
                year=2026,
                original_filename="preview.pdf",
                stored_path="/tmp/preview.pdf",
                status=PublicationScheduleUploadStatus.previewed,
            ),
        ])
        db.commit()
    finally:
        db.close()

    response = client.get("/api/schedule/uploads?year=2026")
    assert response.status_code == 200, response.text
    assert {item["original_filename"] for item in response.json()} == {
        "committed.pdf",
        "preview.pdf",
    }

    db = SessionLocal()
    try:
        assert db.query(PublicationScheduleUpload).count() == 2
    finally:
        db.close()
