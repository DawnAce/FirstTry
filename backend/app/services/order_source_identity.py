"""销售来源的唯一业务口径；原始附件和来源版本不在这里改写。"""
from functools import wraps
from hashlib import sha256
from threading import RLock
from typing import Callable, ParamSpec, TypeVar

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, text
from sqlalchemy.orm import Session

SOURCE_CATALOG = (
    {"platform": "微信小程序", "store": "CBJ+", "aliases": ["CBJ小程序", "CBJ+小程序", "CBJ+"]},
    {"platform": "淘宝", "store": "中国经营报发行部", "aliases": ["淘宝发行部"]},
    {"platform": "有赞", "store": "中国经营报微店", "aliases": []},
)
_CATALOG = {name: row for row in SOURCE_CATALOG for name in [row["platform"], *row["aliases"]]}
_lock = RLock()
_P = ParamSpec("_P")
_R = TypeVar("_R")


def canonical_platform(platform: str | None) -> str | None:
    value = (platform or "").strip() or None
    return _CATALOG[value]["platform"] if value in _CATALOG else value


def normalize_source(platform: str | None, store: str | None, *, validate: bool = False) -> tuple[str | None, str | None]:
    platform, store = (platform or "").strip() or None, (store or "").strip() or None
    rule = _CATALOG.get(platform)
    if rule:
        if store and store != rule["store"]:
            if validate:
                raise HTTPException(422, f"来源平台「{rule['platform']}」对应店铺应为「{rule['store']}」")
            return rule["platform"], store  # 未识别店铺不擅自归并。
        return rule["platform"], rule["store"]
    return platform, store


def platform_filter(column, platform: str):
    rule = _CATALOG.get(platform.strip())
    return column.in_([rule["platform"], *rule["aliases"]]) if rule else column == platform


def identity_filter(platform_column, store_column, platform: str | None, store: str | None, *, legacy_empty: bool = False):
    platform, store = normalize_source(platform, store)
    rule = _CATALOG.get(platform)
    if rule and store == rule["store"]:
        condition = and_(platform_filter(platform_column, platform), func.coalesce(store_column, "").in_(["", store]))
    else:
        condition = and_(platform_column == platform, func.coalesce(store_column, "") == (store or ""))
    # 兼容早期未填写销售来源的订单；来源交易本身不允许匿名身份。
    if legacy_empty:
        condition = or_(condition, and_(platform_column.is_(None), func.coalesce(store_column, "") == ""))
    return condition


def matching_orders(db: Session, number: str, platform: str | None, store: str | None, *, lock: bool = False):
    from app.models import Order, OrderStatus
    query = db.query(Order).filter(Order.external_order_no == number, Order.status != OrderStatus.void,
        identity_filter(Order.source_platform, Order.source_store, platform, store, legacy_empty=True)).populate_existing()
    if lock:
        query = query.with_for_update()
    return query.all()


def unique_order(db: Session, number: str, platform: str | None, store: str | None, *, lock: bool = False):
    rows = matching_orders(db, number, platform, store, lock=lock)
    if len(rows) > 1:
        raise HTTPException(409, "来源身份冲突：同一平台、店铺及来源单号存在多个订单，请先核对重复订单")
    return rows[0] if rows else None


def serialized_identity(operation: Callable[_P, _R]) -> Callable[_P, _R]:
    """手工入口与导入共用锁；MySQL 使用独立连接持有会话锁直至业务提交结束。

    使用一把业务锁，避免按整批每个单号增加公网往返。SQLite/单元测试只用进程锁。
    """
    @wraps(operation)
    def wrapped(db, *args, **kwargs):
        with _lock:
            bind = db.get_bind() if isinstance(db, Session) else None
            if bind is None or bind.dialect.name != "mysql":
                return operation(db, *args, **kwargs)
            key = "order-source:" + sha256(str(bind.url.database).encode()).hexdigest()[:32]
            with bind.connect() as guard:
                acquired = guard.execute(text("SELECT GET_LOCK(:key, 10)"), {"key": key}).scalar()
                if acquired != 1:
                    raise HTTPException(409, "其他订单正在保存，请稍后重试")
                try:
                    return operation(db, *args, **kwargs)
                except Exception:
                    db.rollback()
                    raise
                finally:
                    try:
                        guard.execute(text("SELECT RELEASE_LOCK(:key)"), {"key": key})
                    except Exception:
                        guard.invalidate()  # 断开持锁连接，禁止带锁归还连接池。
    return wrapped
