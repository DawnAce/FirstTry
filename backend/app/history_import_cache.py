"""Short-lived in-memory session store for history import previews."""

import time
import uuid

_TTL_SECONDS = 600  # 10 minutes
_store: dict[str, tuple[dict, float]] = {}


def _cleanup() -> None:
    now = time.time()
    expired = [k for k, (_, ts) in list(_store.items()) if now - ts > _TTL_SECONDS]
    for k in expired:
        del _store[k]


def save_history_import_session(payload: dict) -> str:
    session_id = str(uuid.uuid4())
    _store[session_id] = (payload, time.time())
    _cleanup()
    return session_id


def get_history_import_session(session_id: str) -> dict | None:
    _cleanup()
    entry = _store.get(session_id)
    if entry is None:
        return None
    payload, ts = entry
    if time.time() - ts > _TTL_SECONDS:
        del _store[session_id]
        return None
    return payload


def pop_history_import_session(session_id: str) -> dict | None:
    payload = get_history_import_session(session_id)
    if payload is not None:
        _store.pop(session_id, None)
    return payload
