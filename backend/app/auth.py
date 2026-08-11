from datetime import datetime, timedelta, timezone
import threading
import time
from typing import Optional

import bcrypt
from jose import jwt, JWTError
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.database import get_db
from app.config import get_settings
from app.models.user import User, UserRole

settings = get_settings()
SECRET_KEY = settings.JWT_SECRET
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = settings.ACCESS_TOKEN_EXPIRE_HOURS

security = HTTPBearer()

# A page commonly opens several API requests at once.  JWT verification is
# local, but the historical implementation still fetched the same user over
# the high-latency DB link for every request.  Keep a deliberately short cache
# so deletion/role changes propagate quickly while bursts share one lookup.
_USER_CACHE_TTL_SECONDS = 30
_user_cache: dict[int, tuple[float, str, UserRole]] = {}
_user_cache_lock = threading.Lock()


def _user_from_cache_value(user_id: int, username: str, role: UserRole) -> User:
    return User(id=user_id, username=username, role=role, password_hash="")


def cache_authenticated_user(user: User) -> None:
    with _user_cache_lock:
        _user_cache[user.id] = (
            time.monotonic() + _USER_CACHE_TTL_SECONDS,
            user.username,
            user.role,
        )


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def create_access_token(user_id: int, username: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    payload = {
        "sub": str(user_id),
        "username": username,
        "role": role,
        "exp": expire,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload.get("sub"))
    except (JWTError, ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的登录凭证")

    now = time.monotonic()
    # Keep the lock through the miss query: concurrent page requests for the
    # same user wait for one lookup instead of causing a cache stampede.
    with _user_cache_lock:
        cached = _user_cache.get(user_id)
        if cached is not None and cached[0] > now:
            return _user_from_cache_value(user_id, cached[1], cached[2])

        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            _user_cache.pop(user_id, None)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在")
        _user_cache[user_id] = (
            now + _USER_CACHE_TTL_SECONDS,
            user.username,
            user.role,
        )
        return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role.value != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return user


def require_mutation_permission(
    request: Request,
    user: User = Depends(get_current_user),
) -> User:
    """Allow viewers to browse and download, but never mutate business data."""
    role_value = getattr(user.role, "value", user.role)
    if role_value == "viewer" and request.method not in {"GET", "HEAD", "OPTIONS"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="演示账号为只读权限，不能执行修改操作",
        )
    return user
