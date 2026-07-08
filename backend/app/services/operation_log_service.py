"""通用操作日志写入助手。

所有 ZTO-MF 相关写操作统一走 :func:`record_operation`：

* 只 ``db.add``、**不 commit** —— 随调用方事务落库，出错一起回滚，保持原子性。
* 操作人可传 ``user`` 对象，或直接传 ``user_id`` / ``username``
  （批量服务里只有 ``operator_id``，没有 User 对象）。
* 中文标签不落库，由读取端（``schemas.operation_log.ACTION_LABELS`` + 前端）按 action 派生。
"""

from __future__ import annotations

from typing import Any, Optional

from sqlalchemy.orm import Session

from app.models.operation_log import OperationLog
from app.models.user import User


def record_operation(
    db: Session,
    *,
    table_name: str,
    record_id: int,
    action: str,
    user: Optional[User] = None,
    user_id: Optional[int] = None,
    username: Optional[str] = None,
    record_name: Optional[str] = None,
    changes: Optional[Any] = None,
    issue_number: Optional[int] = None,
    channel: Optional[str] = None,
    status: str = "success",
) -> OperationLog:
    """Build an :class:`OperationLog` row and add it to the session (no commit).

    Pass either a ``user`` object or explicit ``user_id`` / ``username``. The
    caller owns the transaction and commits later, so the log joins the same
    unit of work and rolls back with it on error.
    """
    if user is not None:
        user_id = user.id
        username = user.username
    log = OperationLog(
        table_name=table_name,
        record_id=record_id,
        record_name=record_name,
        action=action,
        changes=changes,
        user_id=user_id,
        username=username,
        issue_number=issue_number,
        channel=channel,
        status=status,
    )
    db.add(log)
    return log
