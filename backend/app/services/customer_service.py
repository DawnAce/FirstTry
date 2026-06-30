"""收报人聚合（客户管理 v0，只读）。

「客户 = 收报人」：把订单履约目标(fulfillment_targets)按 收件人姓名 + 电话 归并，
回答「谁在订、订了多少份、涉及哪些刊物、关联几张订单」。这是一个只读聚合视图，
**不引入客户主数据表**；将来若需真正的客户主档（合并去重 / 信用 / 标签 / 付款方维度），
再在此之上升级。

口径（与活动统计的营收口径一致 + 收敛到履约维度）：
* 订单 ``status == active``        —— 草稿 / 待确认 / 作废不计
* 排除已退款 / 已取消单            —— ``commercial_status``；手工单 NULL 照计
* 订单明细 ``status == active``    —— 已取消行不计
* **仅当前分配版本**               —— ``allocation.effective_until_issue IS NULL``
  （改派会生成新版本，旧版本目标不会被改状态，只靠当前版本区分；不限定会跨版本重复计）
* 履约目标 ``status == active``    —— 当前版本内被暂停 / 已替换的目标不计
→ 即「当前在订的收报人」。退款 / 作废等历史不在 v0 口径内。
"""

from typing import Optional

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models.fulfillment_allocation import FulfillmentAllocation
from app.models.fulfillment_target import FulfillmentTarget, TargetStatus
from app.models.order import Order, OrderCommercialStatus, OrderStatus
from app.models.order_item import OrderItem, OrderItemStatus
from app.schemas.customer import (
    CustomerDetailOut,
    CustomerListOut,
    CustomerOrderLine,
    CustomerRow,
)

# 退款 / 取消单不计入在订口径（手工单 commercial_status 为 NULL → 照常计入）。
_EXCLUDED_COMMERCIAL_STATUSES = (
    OrderCommercialStatus.refunded,
    OrderCommercialStatus.cancelled,
)


def _revenue_eligible():
    """SQL 过滤：排除已退款 / 已取消的订单（NULL 商业状态——手工单——保留）。"""
    return or_(
        Order.commercial_status.is_(None),
        Order.commercial_status.notin_(_EXCLUDED_COMMERCIAL_STATUSES),
    )


def _eligible_target_query(db: Session):
    """生效订单 × 有效明细 × 当前分配版本 × 有效履约目标 的基础联表查询。

    只投影聚合 / 展示所需列（不取整 ORM 对象），与 analytics 服务同风格。
    """
    return (
        db.query(
            FulfillmentTarget.id.label("target_id"),
            FulfillmentTarget.recipient_name,
            FulfillmentTarget.recipient_phone,
            FulfillmentTarget.recipient_address,
            FulfillmentTarget.quantity,
            FulfillmentTarget.shipping_channel,
            FulfillmentTarget.status.label("target_status"),
            OrderItem.publication,
            OrderItem.fulfillment_type,
            OrderItem.coverage_start_date,
            OrderItem.coverage_end_date,
            OrderItem.issue_label,
            OrderItem.issue_number,
            Order.id.label("order_id"),
            Order.order_code,
            Order.order_date,
            Order.status.label("order_status"),
            Order.commercial_status,
        )
        .join(OrderItem, FulfillmentTarget.order_item_id == OrderItem.id)
        .join(Order, OrderItem.order_id == Order.id)
        .join(
            FulfillmentAllocation,
            FulfillmentTarget.allocation_id == FulfillmentAllocation.id,
        )
        .filter(Order.status == OrderStatus.active)
        .filter(_revenue_eligible())
        .filter(OrderItem.status == OrderItemStatus.active)
        .filter(FulfillmentAllocation.effective_until_issue.is_(None))
        .filter(FulfillmentTarget.status == TargetStatus.active)
    )


def _phone_key(phone: Optional[str]) -> str:
    """归并键里的电话：去首尾空白；None 与空串视为同一组「无电话」。"""
    return (phone or "").strip()


def _name_key(name: Optional[str]) -> str:
    """归并键里的姓名：去除首尾空白，规避导入数据的零散空格。

    刻意只做 strip、不折叠大小写 / 重音——中文姓名无大小写，折叠重音可能误并不同人。
    这也意味着归并必须在 Python 侧按字节判等，**不能下推成 SQL 等值**：MySQL 默认排序规则
    (utf8mb4_general_ci / _0900_ai_ci) 大小写 / 重音 / 尾空格不敏感，SQL ``==`` 会比 Python 多
    命中，从而破坏「详情份数之和 == 列表行 total_quantity」的不变量（SQLite 是二进制比较，
    复现不出此差异）。详见 ``get_customer_detail`` 的实现。
    """
    return (name or "").strip()


def _enum_value(value) -> str:
    return value.value if hasattr(value, "value") else str(value)


def list_customers(
    db: Session,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
) -> CustomerListOut:
    """收报人聚合列表（按 姓名 + 电话 归并）。

    ``search`` 在 SQL 层按 姓名 / 电话 / 地址 模糊匹配收窄行集；聚合、排序、分页在
    Python 完成（与 bs-circulation 同思路）。默认排序：在订份数 desc → 订单数 desc → 姓名 asc。
    """
    q = _eligible_target_query(db)
    if search and search.strip():
        like = f"%{search.strip()}%"
        q = q.filter(
            or_(
                FulfillmentTarget.recipient_name.like(like),
                FulfillmentTarget.recipient_phone.like(like),
                FulfillmentTarget.recipient_address.like(like),
            )
        )
    rows = q.all()

    groups: dict[tuple[str, str], dict] = {}
    for r in rows:
        # 归并键 = (去空白姓名, 去空白电话)。代表值也存规范化后的值，
        # 因为前端会拿它回查详情——必须与 get_customer_detail 的判等口径完全一致。
        key = (_name_key(r.recipient_name), _phone_key(r.recipient_phone))
        g = groups.get(key)
        if g is None:
            g = groups[key] = {
                "recipient_name": key[0],
                "recipient_phone": key[1] or None,
                "order_ids": set(),
                "total_quantity": 0,
                "publications": set(),
                "addresses": [],  # (target_id, address) —— 取 target_id 最大者为代表地址
                "last_order_date": None,
            }
        g["order_ids"].add(r.order_id)
        g["total_quantity"] += int(r.quantity or 0)
        g["publications"].add(_enum_value(r.publication))
        g["addresses"].append((r.target_id, r.recipient_address))
        if r.order_date is not None and (
            g["last_order_date"] is None or r.order_date > g["last_order_date"]
        ):
            g["last_order_date"] = r.order_date

    result_rows = []
    for g in groups.values():
        primary_address = None
        address_count = 0
        if g["addresses"]:
            primary_address = max(g["addresses"], key=lambda t: t[0])[1]
            address_count = len({addr for _, addr in g["addresses"]})
        result_rows.append(
            CustomerRow(
                recipient_name=g["recipient_name"],
                recipient_phone=g["recipient_phone"],
                primary_address=primary_address,
                address_count=address_count,
                order_count=len(g["order_ids"]),
                total_quantity=g["total_quantity"],
                publications=sorted(g["publications"]),
                last_order_date=g["last_order_date"],
            )
        )

    result_rows.sort(
        key=lambda r: (-r.total_quantity, -r.order_count, r.recipient_name)
    )
    total = len(result_rows)
    start = max(page - 1, 0) * page_size
    paged = result_rows[start : start + page_size]
    return CustomerListOut(rows=paged, total=total)


def get_customer_detail(
    db: Session,
    recipient_name: str,
    recipient_phone: Optional[str] = None,
) -> CustomerDetailOut:
    """单个收报人（同一 姓名 + 电话）的全部在订履约明细。

    电话为空（None / 空串）时匹配「无电话」组；非空时按精确电话匹配，与列表归并键一致。
    口径与列表完全相同，因此明细 ``quantity`` 之和等于列表中的 ``total_quantity``。

    实现要点（跨库一致性）：SQL 仅用 ``TRIM`` 等值做**超集预筛**（两库都去首尾空白），
    再在 Python 里按与列表完全相同的规范化键(``_name_key`` / ``_phone_key``)逐字节收窄。
    这样无论后端库排序规则如何（MySQL 默认大小写 / 重音不敏感），详情与列表口径都逐字节一致，
    不会把大小写 / 重音仅有差异的同名收报人误并进来——参见 ``_name_key`` 的说明。
    """
    name_key = _name_key(recipient_name)
    phone_key = _phone_key(recipient_phone)
    q = _eligible_target_query(db).filter(
        func.trim(FulfillmentTarget.recipient_name) == name_key
    )
    if phone_key:
        q = q.filter(func.trim(FulfillmentTarget.recipient_phone) == phone_key)
    else:
        q = q.filter(
            or_(
                FulfillmentTarget.recipient_phone.is_(None),
                func.trim(FulfillmentTarget.recipient_phone) == "",
            )
        )
    # Python 端按列表同款规范化键收窄（权威判等，与后端库排序规则无关）。
    rows = [
        r
        for r in q.order_by(Order.order_date.desc(), Order.id.desc()).all()
        if _name_key(r.recipient_name) == name_key
        and _phone_key(r.recipient_phone) == phone_key
    ]

    lines = []
    order_ids = set()
    publications = set()
    total_quantity = 0
    for r in rows:
        order_ids.add(r.order_id)
        publications.add(_enum_value(r.publication))
        total_quantity += int(r.quantity or 0)
        lines.append(
            CustomerOrderLine(
                target_id=r.target_id,
                order_id=r.order_id,
                order_code=r.order_code,
                order_date=r.order_date,
                order_status=_enum_value(r.order_status),
                commercial_status=(
                    _enum_value(r.commercial_status)
                    if r.commercial_status is not None
                    else None
                ),
                publication=_enum_value(r.publication),
                fulfillment_type=_enum_value(r.fulfillment_type),
                quantity=int(r.quantity or 0),
                coverage_start_date=r.coverage_start_date,
                coverage_end_date=r.coverage_end_date,
                issue_label=r.issue_label,
                issue_number=r.issue_number,
                shipping_channel=_enum_value(r.shipping_channel),
                recipient_address=r.recipient_address,
                target_status=_enum_value(r.target_status),
            )
        )

    return CustomerDetailOut(
        recipient_name=name_key,
        recipient_phone=phone_key or None,
        total_quantity=total_quantity,
        order_count=len(order_ids),
        publications=sorted(publications),
        lines=lines,
    )
