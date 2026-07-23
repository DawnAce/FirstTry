"""兼容导出：改地址与回访已物理合并到 ``postal_ticket``。"""

from app.models.postal_ticket import PostalAddressChange, PostalFollowUp

__all__ = ["PostalAddressChange", "PostalFollowUp"]
