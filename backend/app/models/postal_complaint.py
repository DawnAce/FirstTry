"""兼容导出：邮局工单模型已物理合并到 ``postal_ticket``。"""

from app.models.postal_ticket import (
    PostalComplaint,
    PostalComplaintHandlingRecord,
    PostalComplaintStatus,
)

__all__ = [
    "PostalComplaint",
    "PostalComplaintHandlingRecord",
    "PostalComplaintStatus",
]
