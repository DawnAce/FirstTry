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
            issue_number=issue_number if not is_suspended else None,
            publish_date=date(2026, month, day),
            is_suspended=is_suspended,
        )
        db.add(entry)
        count += 1

    db.commit()
    return count
