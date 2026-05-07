"""Simple in-memory cache for dashboard data to reduce DB round-trips."""

import time

_dashboard_cache: dict = {"data": None, "expires_at": 0}
DASHBOARD_CACHE_TTL = 30  # seconds


def get_dashboard_cache() -> dict | None:
    if _dashboard_cache["data"] is not None and time.time() < _dashboard_cache["expires_at"]:
        return _dashboard_cache["data"]
    return None


def set_dashboard_cache(data: dict) -> None:
    global _dashboard_cache
    _dashboard_cache = {"data": data, "expires_at": time.time() + DASHBOARD_CACHE_TTL}


def invalidate_dashboard_cache() -> None:
    global _dashboard_cache
    _dashboard_cache = {"data": None, "expires_at": 0}
