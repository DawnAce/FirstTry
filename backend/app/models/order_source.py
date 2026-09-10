"""平台交易原件、不可变版本及业务归属；运费不伪装成刊物明细。"""
from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, JSON, Numeric, String, Text, UniqueConstraint
from sqlalchemy.sql import func
from app.database import Base


class OrderSource(Base):
    __tablename__ = "order_sources"
    id = Column(Integer, primary_key=True)
    platform = Column(String(64), nullable=False)
    store = Column(String(128), nullable=False, default="")
    external_order_no = Column(String(128), nullable=False, index=True)
    kind = Column(String(32), nullable=False)  # subscription / shipping_fee / record
    revision = Column(Integer, nullable=False, default=1)
    lock_version = Column(Integer, nullable=False, default=1)
    order_date = Column(Date, nullable=True, index=True)
    recipient_name = Column(String(128), nullable=False, default="", index=True)
    recipient_phone = Column(String(64), nullable=False, default="", index=True)
    recipient_address = Column(Text, nullable=False, default="")
    commercial_status = Column(String(32), nullable=True)
    paid_amount = Column(Numeric(10, 2), nullable=False, default=0)
    # NULL means the source states refunded, but its amount/date are not verified.
    verified_refund_amount = Column(Numeric(10, 2), nullable=True)
    verified_refund_date = Column(Date, nullable=True)
    finance_note = Column(Text, nullable=True)
    finance_review_required = Column(Boolean, nullable=False, default=False, server_default="0")
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    __table_args__ = (UniqueConstraint("platform", "store", "external_order_no", name="uq_order_source_identity"),)


class OrderSourceVersion(Base):
    __tablename__ = "order_source_versions"
    id = Column(Integer, primary_key=True)
    source_id = Column(Integer, ForeignKey("order_sources.id"), nullable=False, index=True)
    revision = Column(Integer, nullable=False)
    fingerprint = Column(String(64), nullable=False)
    snapshot = Column(JSON, nullable=False)
    search_text = Column(Text, nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    __table_args__ = (UniqueConstraint("source_id", "revision", name="uq_order_source_revision"),)


class OrderSourceLink(Base):
    __tablename__ = "order_source_links"
    id = Column(Integer, primary_key=True)
    source_id = Column(Integer, ForeignKey("order_sources.id"), nullable=False, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, index=True)
    order_item_id = Column(Integer, ForeignKey("order_items.id"), nullable=True)
    target_id = Column(Integer, ForeignKey("fulfillment_targets.id"), nullable=True)
    amount = Column(Numeric(10, 2), nullable=False)
    refund_amount = Column(Numeric(10, 2), nullable=True)
    active = Column(Integer, nullable=False, default=1)
    delivery_from_issue = Column(Integer, nullable=True)
    reason = Column(Text, nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())


class OrderSourceEvent(Base):
    __tablename__ = "order_source_events"
    id = Column(Integer, primary_key=True)
    source_id = Column(Integer, ForeignKey("order_sources.id"), nullable=False, index=True)
    action = Column(String(48), nullable=False)
    payload = Column(JSON, nullable=False)
    operator_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())


class OrderSourceDeliveryChange(Base):
    """每次转投及撤回的原始依据，不删除履约目标或既有投递记录。"""
    __tablename__ = "order_source_delivery_changes"
    id = Column(Integer, primary_key=True)
    source_id = Column(Integer, ForeignKey("order_sources.id"), nullable=False, index=True)
    link_id = Column(Integer, ForeignKey("order_source_links.id"), nullable=False)
    from_target_id = Column(Integer, ForeignKey("fulfillment_targets.id"), nullable=False)
    to_target_id = Column(Integer, ForeignKey("fulfillment_targets.id"), nullable=False)
    effective_from_issue = Column(Integer, nullable=False)
    effective_date = Column(Date, nullable=False)
    status = Column(String(16), nullable=False, default="applied")
    previous_state = Column(JSON, nullable=False)
    reason = Column(Text, nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
