from concurrent.futures import ThreadPoolExecutor
from contextvars import ContextVar, Token
from threading import Barrier, BrokenBarrierError
import time

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase

from app.config import get_settings

settings = get_settings()

engine = create_engine(
    settings.DATABASE_URL,
    # A pre-ping adds one public-network SQL round-trip to every request.  The
    # one-hour recycle window is already below the database idle timeout, so
    # normal page loads should use the pooled connection immediately.
    pool_pre_ping=False,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_POOL_MAX_OVERFLOW,
    # Remote MySQL handshakes are expensive.  Recycling every five minutes
    # repeatedly put that cost on normal page views; one hour is still safely
    # below common MySQL idle timeouts.
    pool_recycle=3600,
    pool_use_lifo=True,
    pool_timeout=10,
    connect_args={"connect_timeout": 5, "read_timeout": 10, "write_timeout": 10},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

_query_metrics: ContextVar[dict[str, float | int] | None] = ContextVar(
    "query_metrics", default=None
)


def begin_query_metrics() -> tuple[dict[str, float | int], Token]:
    metrics: dict[str, float | int] = {"count": 0, "duration_ms": 0.0}
    return metrics, _query_metrics.set(metrics)


def end_query_metrics(token: Token) -> None:
    _query_metrics.reset(token)


@event.listens_for(engine, "before_cursor_execute")
def _before_cursor_execute(_conn, _cursor, _statement, _params, context, _many):
    context._performance_started_at = time.perf_counter()


@event.listens_for(engine, "after_cursor_execute")
def _after_cursor_execute(_conn, _cursor, _statement, _params, context, _many):
    metrics = _query_metrics.get()
    started = getattr(context, "_performance_started_at", None)
    if metrics is None or started is None:
        return
    metrics["count"] = int(metrics["count"]) + 1
    metrics["duration_ms"] = float(metrics["duration_ms"]) + (
        time.perf_counter() - started
    ) * 1000


class Base(DeclarativeBase):
    pass


def warm_connection_pool(count: int | None = None) -> int:
    """Open the core request connections concurrently during application startup.

    Holding every checkout until the barrier opens forces QueuePool to create
    distinct connections.  This moves expensive public-MySQL handshakes out of
    the first multi-request page load.
    """
    target = min(count or settings.DB_POOL_WARM_SIZE, settings.DB_POOL_SIZE)
    barrier = Barrier(target + 1, timeout=30)

    def warm_one() -> None:
        try:
            with engine.connect() as connection:
                connection.execute(text("SELECT 1")).scalar()
                barrier.wait()
        except BaseException:
            barrier.abort()
            raise

    with ThreadPoolExecutor(max_workers=target) as executor:
        futures = [executor.submit(warm_one) for _ in range(target)]
        try:
            barrier.wait()
        except BrokenBarrierError:
            # Surface the original connection failure, not the barrier error.
            for future in futures:
                future.result()
            raise
        for future in futures:
            future.result()
    return target


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
