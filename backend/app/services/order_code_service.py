"""Order code generation service.

Generates a sequential, human-readable order code in the form
``ORD-YYYY-NNNNNN`` where ``YYYY`` is the order year and ``NNNNNN`` is
a 6-digit zero-padded sequence number that resets each year.

This is a V1.1 simplification: order volume is low (manual entry only),
so we don't bother with database-side sequences or row locking. The
caller is responsible for inserting the order; this function just
returns the next code based on a COUNT(*) of existing rows.

For V2 (batch import / higher volume) we may need to add row-level
locking or a dedicated sequence table — that is deliberately out of
scope here. See ``decisions`` table key ``v1-mvp-scope``.
"""

from sqlalchemy.orm import Session

from app.models import Order


def generate_order_code(db: Session, year: int) -> str:
    """Return the next order code for the given year.

    The returned code is *not* yet persisted; the caller must create
    and commit the ``Order`` row. Because we count existing rows
    without locking, two concurrent calls in the same year could
    return the same code, but for V1.1 manual single-entry this is
    acceptable. The unique constraint on ``orders.order_code`` is the
    final safety net.
    """
    pattern = f"ORD-{year}-%"
    existing = db.query(Order).filter(Order.order_code.like(pattern)).count()
    next_seq = existing + 1
    # Keep the zero-padding at 6 digits for the common case, but never
    # truncate if we somehow exceed 999_999 — uniqueness wins over format.
    return f"ORD-{year}-{next_seq:06d}"
