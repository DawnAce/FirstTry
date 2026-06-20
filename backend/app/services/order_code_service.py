"""Order code generation service.

Generates a sequential, human-readable order code in the form
``ORD-YYYY-NNNNNN`` where ``YYYY`` is the order year and ``NNNNNN`` is a
6-digit zero-padded sequence number that resets each year.

The next sequence is derived from the **max existing suffix** for the year
(not ``COUNT(*)``): COUNT breaks if any coded order was ever deleted (it would
re-issue a used number and collide on the unique constraint), whereas max+1 is
stable against gaps. For batch import, ``allocate_order_codes`` hands out a
contiguous block from a single query so a loop of N inserts does not run N
COUNT/MAX queries (O(N^2)) and the codes within the batch can't collide.

Concurrency: this assumes a **single application worker** (the deployment
reality for this internal tool) — within one process the block allocation is
collision-free. Across processes there is still a small race window; the unique
constraint on ``orders.order_code`` remains the final safety net. If this ever
runs multi-worker, switch to a year-keyed counter table with ``SELECT ... FOR
UPDATE`` or a DB sequence.
"""

import re

from sqlalchemy.orm import Session

from app.models import Order


_CODE_RE = re.compile(r"^ORD-(\d{4})-(\d+)$")


def _max_seq(db: Session, year: int) -> int:
    """Highest sequence number currently used for ``year`` (0 if none)."""
    prefix = f"ORD-{year}-"
    rows = (
        db.query(Order.order_code)
        .filter(Order.order_code.like(f"{prefix}%"))
        .all()
    )
    max_seq = 0
    for (code,) in rows:
        match = _CODE_RE.match(code or "")
        if match and int(match.group(1)) == year:
            max_seq = max(max_seq, int(match.group(2)))
    return max_seq


def _format(year: int, seq: int) -> str:
    # Zero-pad to 6 digits for the common case; never truncate beyond that —
    # uniqueness wins over format.
    return f"ORD-{year}-{seq:06d}"


def generate_order_code(db: Session, year: int) -> str:
    """Return the next order code for ``year`` (not yet persisted).

    The caller must create and commit the ``Order`` row.
    """
    return _format(year, _max_seq(db, year) + 1)


def allocate_order_codes(db: Session, year: int, count: int) -> list[str]:
    """Return ``count`` contiguous order codes for ``year`` (not yet persisted).

    Computes the starting sequence once, so a batch import assigns all codes
    from a single query. The caller must insert the rows; codes within the
    returned block are unique by construction (single-worker assumption).
    """
    if count < 0:
        raise ValueError("count must be non-negative")
    start = _max_seq(db, year) + 1
    return [_format(year, start + i) for i in range(count)]
