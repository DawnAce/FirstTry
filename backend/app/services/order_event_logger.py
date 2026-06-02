"""Order event logger helper.

A trivial helper that appends a row to ``order_events`` so callers
don't have to remember the model fields. It deliberately does NOT
commit — the caller controls the surrounding transaction so an event
and the state change that triggered it land atomically.

Typical usage in a service::

    from app.services.order_event_logger import log_event
    from app.models import OrderEventType

    log_event(
        db,
        order_id=order.id,
        event_type=OrderEventType.confirmed,
        payload={"order_code": order.order_code},
        operator_id=current_user_id,
    )
    db.commit()  # caller owns the commit
"""

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
    """Append an ``order_events`` row and flush so the id is populated.

    Does not commit. Returns the persisted (but uncommitted) event so
    the caller can inspect ``event.id`` / ``event.created_at`` if needed.
    """
    event = OrderEvent(
        order_id=order_id,
        event_type=event_type,
        payload_json=payload,
        operator_id=operator_id,
    )
    db.add(event)
    db.flush()
    return event
