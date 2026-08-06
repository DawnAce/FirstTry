from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from jose import jwt
from pydantic import ValidationError

from app import auth
from app.config import Settings


def test_jwt_uses_configured_secret_and_short_expiry():
    token = auth.create_access_token(7, "admin", "admin")
    payload = jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])

    assert payload["sub"] == "7"
    assert 0 < (datetime.fromtimestamp(payload["exp"], timezone.utc) - datetime.now(timezone.utc)).total_seconds() <= 24 * 3600


def test_settings_reject_short_jwt_secret():
    with pytest.raises(ValidationError):
        Settings(
            MYSQL_HOST="localhost",
            MYSQL_USER="test",
            MYSQL_PASSWORD="test",
            MYSQL_DATABASE="test",
            JWT_SECRET="too-short",
            _env_file=None,
        )


def test_viewer_cannot_mutate_but_can_read():
    viewer = SimpleNamespace(role=SimpleNamespace(value="viewer"))

    assert auth.require_mutation_permission(SimpleNamespace(method="GET"), viewer) is viewer
    with pytest.raises(HTTPException) as exc_info:
        auth.require_mutation_permission(SimpleNamespace(method="POST"), viewer)

    assert exc_info.value.status_code == 403
    assert "只读" in exc_info.value.detail


def test_operator_can_mutate():
    operator = SimpleNamespace(role=SimpleNamespace(value="operator"))

    assert auth.require_mutation_permission(SimpleNamespace(method="POST"), operator) is operator


def test_mutation_permission_accepts_string_roles_from_integrations():
    admin = SimpleNamespace(role="admin")
    viewer = SimpleNamespace(role="viewer")

    assert auth.require_mutation_permission(SimpleNamespace(method="POST"), admin) is admin
    with pytest.raises(HTTPException) as exc_info:
        auth.require_mutation_permission(SimpleNamespace(method="DELETE"), viewer)

    assert exc_info.value.status_code == 403
