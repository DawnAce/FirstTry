import type {
  BillingType,
  DeliveryMethod,
  FulfillmentType,
  OrderCommercialStatus,
  OrderEntryMethod,
  OrderEventType,
  OrderItemStatus,
  OrderPaymentMethod,
  OrderStatus,
  Publication,
  SubscriptionTerm,
  TargetStatus,
} from '../api/orders';

// =============================================================================
// Label maps (Chinese)
// =============================================================================

// 录入方式（PR-B 起列名为 entry_method，枚举收敛为 manual/excel_import/api_sync）。
// 手工录入入口固定写 manual；Excel 批量导入 / API 同步入口分别写 excel_import / api_sync。
const ENTRY_METHOD_LABELS: Record<OrderEntryMethod, string> = {
  manual: '手工录入',
  excel_import: 'Excel 导入',
  api_sync: 'API 同步',
};

export function entryMethodLabel(value: OrderEntryMethod): string {
  // 未知值原样展示（兜底），便于运维及时发现数据漂移。
  return ENTRY_METHOD_LABELS[value] ?? String(value);
}

const PAYMENT_METHOD_LABELS: Record<OrderPaymentMethod, string> = {
  wechat: '微信',
  alipay: '支付宝',
  bank_card: '银行卡',
  corporate_transfer: '对公转账',
  cash: '现金',
  offset: '冲抵',
  other: '其他',
};

export function paymentMethodLabel(value: OrderPaymentMethod | null | undefined): string {
  if (!value) return '-';
  return PAYMENT_METHOD_LABELS[value] ?? String(value);
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  draft: '草稿',
  pending_confirmation: '待确认',
  active: '生效',
  void: '已作废',
};

export function statusLabel(value: OrderStatus): string {
  return STATUS_LABELS[value] ?? String(value);
}

export type BadgeStatus = 'default' | 'processing' | 'success' | 'error' | 'warning';

const STATUS_BADGE_COLORS: Record<OrderStatus, BadgeStatus> = {
  draft: 'default',
  pending_confirmation: 'processing',
  active: 'success',
  void: 'error',
};

export function statusBadgeColor(value: OrderStatus): BadgeStatus {
  return STATUS_BADGE_COLORS[value] ?? 'default';
}

const COMMERCIAL_STATUS_LABELS: Record<OrderCommercialStatus, string> = {
  pending_payment: '待付款',
  paid: '已付款',
  shipped: '已发货',
  refunded: '已退款',
  partial_refund: '部分退款',
  cancelled: '已取消',
};

export function commercialStatusLabel(
  value: OrderCommercialStatus | null | undefined,
): string {
  if (!value) return '-';
  return COMMERCIAL_STATUS_LABELS[value] ?? String(value);
}

const COMMERCIAL_STATUS_COLORS: Record<OrderCommercialStatus, string> = {
  pending_payment: 'orange',
  paid: 'blue',
  shipped: 'green',
  refunded: 'red',
  partial_refund: 'volcano',
  cancelled: 'default',
};

export function commercialStatusColor(
  value: OrderCommercialStatus | null | undefined,
): string {
  if (!value) return 'default';
  return COMMERCIAL_STATUS_COLORS[value] ?? 'default';
}

const FULFILLMENT_TYPE_LABELS: Record<FulfillmentType, string> = {
  subscription: '订阅',
  single_issue: '单期',
  gift: '赠阅',
  makeup: '补寄',
  extension: '续订',
  replacement: '换订',
};

export function fulfillmentTypeLabel(value: FulfillmentType): string {
  return FULFILLMENT_TYPE_LABELS[value] ?? String(value);
}

const BILLING_TYPE_LABELS: Record<BillingType, string> = {
  paid: '付费',
  free_gift: '免费赠阅',
  bundle_gift: '搭赠',
};

export function billingTypeLabel(value: BillingType): string {
  return BILLING_TYPE_LABELS[value] ?? String(value);
}

export function subscriptionTermLabel(value: SubscriptionTerm | null | undefined): string {
  if (value === 'half_year') return '半年';
  if (value === 'one_year') return '一年';
  if (value === 'custom') return '自定义';
  return '未设置';
}

export function deliveryMethodLabel(value: DeliveryMethod | null | undefined): string {
  if (value === 'post_office') return '邮局投递';
  if (value === 'zto_mf') return 'ZTO-MF 快递';
  return '未设置';
}

const PUBLICATION_LABELS: Record<Publication, string> = {
  cbj: '中国经营报',
  business_school: '商学院',
  other: '其他',
};

export function publicationLabel(value: Publication): string {
  return PUBLICATION_LABELS[value] ?? String(value);
}

const ORDER_ITEM_STATUS_LABELS: Record<OrderItemStatus, string> = {
  active: '有效',
  cancelled: '已取消',
};

export function orderItemStatusLabel(value: OrderItemStatus): string {
  return ORDER_ITEM_STATUS_LABELS[value] ?? String(value);
}

const TARGET_STATUS_LABELS: Record<TargetStatus, string> = {
  active: '有效',
  suspended: '暂停',
  replaced: '已替换',
};

export function targetStatusLabel(value: TargetStatus): string {
  return TARGET_STATUS_LABELS[value] ?? String(value);
}

const TARGET_STATUS_COLORS: Record<TargetStatus, string> = {
  active: 'green',
  suspended: 'orange',
  replaced: 'default',
};

export function targetStatusColor(value: TargetStatus): string {
  return TARGET_STATUS_COLORS[value] ?? 'default';
}

const EVENT_TYPE_LABELS: Record<OrderEventType, string> = {
  created: '创建',
  imported: '导入',
  confirmed: '确认',
  modified: '修改',
  split: '拆分',
  voided: '作废',
  allocation_updated: '分配方案更新',
  target_added: '新增履约目标',
  target_replaced: '履约目标替换',
  target_suspended: '履约目标暂停',
  item_added: '新增明细',
  item_removed: '删除明细',
  item_modified: '修改明细',
  synced_to_shipping: '同步至快递',
  shipping_sync_conflict: '快递同步冲突',
};

export function eventTypeLabel(value: OrderEventType): string {
  return EVENT_TYPE_LABELS[value] ?? String(value);
}

// =============================================================================
// Formatters
// =============================================================================

export function formatCoverage(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  if (!start && !end) return '-';
  return `${start ?? '-'} ~ ${end ?? '-'}`;
}

const currencyFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '-';
  return `¥${currencyFormatter.format(n)}`;
}

// =============================================================================
// Drift helpers
// =============================================================================

export function driftLabel(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  if (value > 0) return `+${value}`;
  return String(value);
}

export type DriftColor = 'success' | 'warning' | 'error' | 'default';

export function driftColor(value: number | null | undefined): DriftColor {
  if (value === null || value === undefined) return 'default';
  if (value === 0) return 'success';
  if (value > 0) return 'warning';
  return 'error';
}

// =============================================================================
// Permissions (which actions are allowed for a given status)
// =============================================================================

export function canEditOrder(status: OrderStatus): boolean {
  return status === 'draft' || status === 'active';
}

export function canConfirmOrder(status: OrderStatus): boolean {
  return status === 'draft' || status === 'pending_confirmation';
}

export function canVoidOrder(status: OrderStatus): boolean {
  return status !== 'void';
}

// 退款 / 取消是「生效订单」上的商业操作；已作废订单不可退；已全额退款 / 已取消不再可退/可取消。
export function canRefundOrder(
  status: OrderStatus,
  commercialStatus: OrderCommercialStatus | null,
): boolean {
  return (
    status === 'active' &&
    commercialStatus !== 'refunded' &&
    commercialStatus !== 'cancelled'
  );
}

export function canCancelOrder(
  status: OrderStatus,
  commercialStatus: OrderCommercialStatus | null,
): boolean {
  return status === 'active' && commercialStatus !== 'cancelled';
}
