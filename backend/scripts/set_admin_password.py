"""Create or reset an administrator password without putting it in shell history."""

import argparse
import getpass

from app.auth import hash_password
from app.database import SessionLocal
from app.models import User, UserRole


def _read_password() -> str:
    password = getpass.getpass("新密码（至少 12 位）: ")
    if len(password) < 12:
        raise SystemExit("密码至少需要 12 位")
    if password != getpass.getpass("再次输入新密码: "):
        raise SystemExit("两次密码不一致")
    return password


def main() -> None:
    parser = argparse.ArgumentParser(description="创建或重置管理员密码")
    parser.add_argument("username", nargs="?", default="admin")
    username = parser.parse_args().username.strip()
    if not username or len(username) > 50:
        raise SystemExit("用户名长度必须为 1–50 位")

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == username).first()
        if user is None:
            user = User(username=username, role=UserRole.admin, password_hash="")
            db.add(user)
        user.password_hash = hash_password(_read_password())
        user.role = UserRole.admin
        db.commit()
    finally:
        db.close()
    print(f"管理员 {username} 已更新")


if __name__ == "__main__":
    main()
