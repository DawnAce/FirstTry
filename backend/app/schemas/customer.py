"""Pydantic schemas for 客户管理 (v0, read-only).

「客户 = 收报人」：把订单履约目标(fulfillment_targets)按 收件人姓名 + 电话 归并。
这些行由 service 层 GROUP BY 聚合而成，是普通 ``BaseModel``（非 from_attributes 投影）。
"""

from datetime import date
from typing import List, Optional

from pydantic import BaseModel


class CustomerRow(BaseModel):
    """一个收报人（按 姓名 + 电话 归并）的聚合行。

    口径见 ``customer_service``：仅计当前在订（active 订单 + 有效明细 + 当前分配版本的
    有效履约目标，排除草稿/作废/退款/取消、暂停/已替换目标）。``total_quantity`` 是该收报人
    每期在订份数；``primary_address`` 是其最近一次出现的收件地址；``address_count`` 是不同
    收件地址数（>1 提示同一人多地址）。
    """

    recipient_name: str
    recipient_phone: Optional[str] = None
    primary_address: Optional[str] = None
    address_count: int
    order_count: int
    total_quantity: int
    publications: List[str]
    last_order_date: Optional[date] = None


class CustomerListOut(BaseModel):
    """收报人聚合列表 + 总数（搜索后、分页前的去重收报人数）。"""

    rows: List[CustomerRow]
    total: int


class CustomerOrderLine(BaseModel):
    """收报人详情里的一条在订履约明细（对应一个履约目标）。"""

    target_id: int
    order_id: int
    order_code: Optional[str] = None
    order_date: date
    order_status: str
    commercial_status: Optional[str] = None
    publication: str
    fulfillment_type: str
    quantity: int
    coverage_start_date: Optional[date] = None
    coverage_end_date: Optional[date] = None
    issue_label: Optional[str] = None
    issue_number: Optional[int] = None
    shipping_channel: str
    recipient_address: str
    target_status: str


class CustomerDetailOut(BaseModel):
    """单个收报人（同一 姓名 + 电话）的全部在订履约明细 + 小计。"""

    recipient_name: str
    recipient_phone: Optional[str] = None
    total_quantity: int
    order_count: int
    publications: List[str]
    lines: List[CustomerOrderLine]
