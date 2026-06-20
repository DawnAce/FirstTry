"""In-memory session cache for the CBJ order import preview → commit handoff.

Mirrors history_import_cache: heavy parse + resolution happens once at preview;
the resolved, ready-to-create payload is cached under a uuid and commit is a cheap
replay. Module-global dict → single-worker only (the deployment reality); lost on
restart. TTL is generous because reviewing an import batch can take a while.
"""

import time
import uuid
from typing import Optional

_TTL_SECONDS = 30 * 60
_store: dict[str, tuple[dict, float]] = {}


def _cleanup() -> None:
    now = time.time()
    expired = [k for k, (_, ts) in _store.items() if now - ts > _TTL_SECONDS]
    for k in expired:
        _store.pop(k, None)


def save_order_import_session(payload: dict) -> str:
    _cleanup()
    session_id = str(uuid.uuid4())
    _store[session_id] = (payload, time.time())
    return session_id


def get_order_import_session(session_id: str) -> Optional[dict]:
    _cleanup()
    entry = _store.get(session_id)
    return entry[0] if entry else None


def pop_order_import_session(session_id: str) -> Optional[dict]:
    _cleanup()
    entry = _store.pop(session_id, None)
    return entry[0] if entry else None
