from app.models.publication_schedule import PublicationSchedule
from app.models.issue import Issue, IssueStatus
from app.models.report_item_template import ReportItemTemplate
from app.models.report_entry import ReportEntry
from app.models.recipient import Recipient, RecipientType, RecipientFrequency, RecipientStatus
from app.models.subscription import Subscription, SubscriptionType
from app.models.shipping_record import ShippingRecord, ShippingStatus
from app.models.user import User, UserRole
from app.models.report_revision import ReportRevision
from app.models.temp_print_detail import TempPrintDetail
from app.models.shipping_detail import (
    ShippingDetail,
    ShippingDetailSourceType,
    ShippingDetailSyncStatus,
)
from app.models.operation_log import OperationLog
from app.models.issue_audit_snapshot import IssueAuditSnapshot
from app.models.publication_schedule_upload import (
    PublicationScheduleUpload,
    PublicationScheduleUploadStatus,
)
from app.models.order import (
    Order,
    OrderCommercialStatus,
    OrderEntryMethod,
    OrderPaymentMethod,
    OrderStatus,
)
from app.models.order_item import (
    BillingType,
    DeliveryMethod,
    FulfillmentType,
    OrderItem,
    OrderItemStatus,
    Publication,
    PublicationFormat,
    SubscriptionTerm,
)
from app.models.fulfillment_allocation import FulfillmentAllocation
from app.models.fulfillment_target import (
    FulfillmentTarget,
    ShippingChannel,
    TargetStatus,
)
from app.models.order_event import OrderEvent, OrderEventType
from app.models.refund import Refund
from app.models.payment import Payment
from app.models.product import CoverageRule, Product
from app.models.bs_issue import BsIssue
from app.models.partner import Partner, PartnerType
from app.models.contract import Contract, ContractStatus
from app.models.invoice import Invoice, InvoiceType
from app.models.channel_settlement import ChannelSettlement, SettlementStatus
from app.models.postal_delivery import (
    PostalBatchStatus,
    PostalDeliveryBatch,
    PostalDeliveryRow,
)
from app.models.postal_complaint import PostalComplaint, PostalComplaintStatus

__all__ = [
    "PublicationSchedule",
    "Issue", "IssueStatus",
    "ReportItemTemplate",
    "ReportEntry",
    "Recipient", "RecipientType", "RecipientFrequency", "RecipientStatus",
    "Subscription", "SubscriptionType",
    "ShippingRecord", "ShippingStatus",
    "User", "UserRole",
    "ReportRevision",
    "TempPrintDetail",
    "ShippingDetail", "ShippingDetailSourceType", "ShippingDetailSyncStatus",
    "OperationLog",
    "IssueAuditSnapshot",
    "PublicationScheduleUpload",
    "PublicationScheduleUploadStatus",
    # Order management (V1.1)
    "Order", "OrderEntryMethod", "OrderCommercialStatus", "OrderPaymentMethod", "OrderStatus",
    "OrderItem", "Publication", "PublicationFormat",
    "FulfillmentType", "BillingType", "DeliveryMethod", "OrderItemStatus", "SubscriptionTerm",
    "FulfillmentAllocation",
    "FulfillmentTarget", "ShippingChannel", "TargetStatus",
    "OrderEvent", "OrderEventType",
    "Refund",
    "Payment",
    # Product catalog (商品库)
    "Product", "CoverageRule",
    # 商学院月刊刊期日历
    "BsIssue",
    # 合同管理（合作渠道 + 渠道合同）
    "Partner", "PartnerType",
    "Contract", "ContractStatus",
    # 财务管理（订单发票 + 渠道结算）
    "Invoice", "InvoiceType",
    "ChannelSettlement", "SettlementStatus",
    # 邮局投递（每月起投批次 + 冻结明细）
    "PostalDeliveryBatch", "PostalDeliveryRow", "PostalBatchStatus",
    "PostalComplaint", "PostalComplaintStatus",
]
