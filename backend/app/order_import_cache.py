"""In-memory session cache for the CBJ order import preview → commit handoff.

Mirrors history_import_cache: heavy parse + resolution happens once at preview;
the resolved, ready-to-create payload is cached under a uuid and commit is a cheap
replay. Module-global dict → single-worker only (the deployment reality); lost on
restart. TTL is generous because reviewing an import batch can take a while.
"""

import time
import uuid
from functools import wraps
from threading import RLock
from typing import Callable, Optional, ParamSpec, TypeVar

_TTL_SECONDS = 30 * 60
_store: dict[str, tuple[dict, float]] = {}
order_import_lock = RLock()
_P = ParamSpec("_P")
_R = TypeVar("_R")


def serialized_import(operation: Callable[_P, _R]) -> Callable[_P, _R]:
    """Serialize draft changes and final commit in the single-worker import flow."""
    @wraps(operation)
    def wrapped(*args: _P.args, **kwargs: _P.kwargs) -> _R:
        with order_import_lock:
            return operation(*args, **kwargs)
    return wrapped


def _cleanup() -> None:
    now = time.time()
    expired = [k for k, (_, ts) in _store.items() if now - ts > _TTL_SECONDS]
    for k in expired:
        _store.pop(k, None)


@serialized_import
def save_order_import_session(payload: dict) -> str:
    _cleanup()
    session_id = str(uuid.uuid4())
    _store[session_id] = (payload, time.time())
    return session_id


@serialized_import
def get_order_import_session(session_id: str) -> Optional[dict]:
    _cleanup()
    entry = _store.get(session_id)
    return entry[0] if entry else None


@serialized_import
def pop_order_import_session(session_id: str) -> Optional[dict]:
    _cleanup()
    entry = _store.pop(session_id, None)
    return entry[0] if entry else None
