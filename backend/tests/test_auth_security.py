from datetime import datetime, timezone

import pytest
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
