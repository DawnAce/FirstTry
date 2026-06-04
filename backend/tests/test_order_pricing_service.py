import os
from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("MYSQL_USER", "test")
os.environ.setdefault("MYSQL_PASSWORD", "test")
os.environ.setdefault("MYSQL_DATABASE", "test")

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
