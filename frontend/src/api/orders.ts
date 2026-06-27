import type { AxiosResponse } from 'axios';
import api from './client';

// =============================================================================
// Enums (mirror backend Pydantic / SQLAlchemy enums)
// =============================================================================

export type OrderStatus = 'draft' | 'pending_confirmation' | 'active' | 'void';

// 平台商业状态（与内部 OrderStatus 正交）。手工单为 null。
export type OrderCommercialStatus =
  | 'pending_payment'
  | 'paid'
  | 'shipped'
  | 'refunded'
  | 'partial_refund'
  | 'cancelled';

// 录入方式（provenance）：数据如何进入系统。与销售渠道（source_platform /
// source_store）正交。PR-B 从旧的 OrderSourceType 收敛而来。
export type OrderEntryMethod = 'manual' | 'excel_import' | 'api_sync';

export type OrderPaymentMethod =
  | 'wechat'
  | 'alipay'
  | 'bank_card'
  | 'corporate_transfer'
  | 'cash'
  | 'offset'
  | 'other';

export type Publication = 'cbj' | 'business_school' | 'other';

export type PublicationFormat = 'paper' | 'digital';

export type FulfillmentType =
  | 'subscription'
  | 'single_issue'
  | 'gift'
  | 'makeup'
  | 'extension'
  | 'replacement';

export type BillingType = 'paid' | 'free_gift' | 'bundle_gift';

export type SubscriptionTerm = 'half_year' | 'one_year' | 'custom';

export type DeliveryMethod = 'post_office' | 'zto_mf';

export type OrderItemStatus = 'active' | 'cancelled';

export type ShippingChannel =
  | 'zto_outsource'
  | 'post_office'
  | 'self_sf'
  | 'other';

export type TargetStatus = 'active' | 'suspended' | 'replaced';

export type OrderEventType =
  | 'created'
  | 'imported'
  | 'confirmed'
  | 'modified'
  | 'split'
  | 'voided'
  | 'allocation_updated'
  | 'target_added'
  | 'target_replaced'
  | 'target_suspended'
  | 'item_added'
  | 'item_removed'
  | 'item_modified'
  | 'synced_to_shipping'
  | 'shipping_sync_conflict';

// =============================================================================
// Inputs (sent to backend)
// =============================================================================

export interface FulfillmentTargetIn {
  recipient_name: string;
  recipient_phone?: string | null;
  recipient_address: string;
  recipient_postal_code?: string | null;
  quantity: number;
  shipping_channel?: ShippingChannel;
  effective_from_issue?: number | null;
  effective_until_issue?: number | null;
  notes?: string | null;
}

export interface OrderItemIn {
  publication?: Publication;
  publication_format?: PublicationFormat;
  fulfillment_type: FulfillmentType;
  billing_type?: BillingType;
  subscription_term?: SubscriptionTerm | null;
  delivery_method?: DeliveryMethod | null;
  term_start_month?: string | null;
  coverage_start_date?: string | null;
  coverage_end_date?: string | null;
  issue_number?: number | null;
  total_quantity: number;
  unit_price?: string | number;
  subtotal?: string | number;
  notes?: string | null;
  targets?: FulfillmentTargetIn[];
}

export interface OrderCreatePayload {
  external_order_no?: string | null;
  order_date: string;
  // 录入方式 provenance；前端可不传（后端手工录入入口固定写 manual）。
  // Excel 批量导入 / API 同步由各自入口设置 excel_import / api_sync。
  entry_method?: OrderEntryMethod;
  source_platform?: string | null;
  source_store?: string | null;
  payer_name: string;
  payer_contact?: string | null;
  payment_method?: OrderPaymentMethod | null;
  payment_collector?: string | null;
  total_amount?: string | number;
  paid_amount?: string | number;
  invoice_required?: boolean;
  invoice_title?: string | null;
  invoice_tax_no?: string | null;
  invoice_recipient_email?: string | null;
  notes?: string | null;
  items: OrderItemIn[];
}

export interface OrderUpdatePayload {
  order_date?: string;
  // NOTE: entry_method 不在 update payload —— 为 provenance 元数据，
  // 任何状态下都不允许通过编辑接口修改（详见 backend OrderUpdate docstring）
  source_platform?: string | null;
  source_store?: string | null;
  external_order_no?: string | null;
  payer_name?: string;
  payer_contact?: string | null;
  payment_method?: OrderPaymentMethod | null;
  payment_collector?: string | null;
  total_amount?: string | number;
  paid_amount?: string | number;
  invoice_required?: boolean;
  invoice_title?: string | null;
  invoice_tax_no?: string | null;
  invoice_recipient_email?: string | null;
  notes?: string | null;
}

export interface OrderVoidPayload {
  reason: string;
}

export interface RefundPayload {
  amount: number | string;
  reason?: string | null;
  // 退某条明细（场景②③）；空 = 订单级。
  order_item_id?: number | null;
  // 从该期起停发（场景③订阅中途退订）。
  stop_from_issue?: number | null;
  refunded_at?: string | null;
}

export interface OrderCancelPayload {
  reason: string;
}

export interface OrderItemUpdate extends OrderItemIn {
  id?: number | null;
}

export interface OrderItemsUpdatePayload {
  effective_from_issue: number;
  change_reason?: string | null;
  items: OrderItemUpdate[];
}

// =============================================================================
// Outputs (received from backend)
// =============================================================================

export interface FulfillmentTargetOut {
  id: number;
  recipient_name: string;
  recipient_phone: string | null;
  recipient_address: string;
  recipient_postal_code: string | null;
  quantity: number;
  shipping_channel: ShippingChannel;
  effective_from_issue: number | null;
  effective_until_issue: number | null;
  status: TargetStatus;
  notes: string | null;
}

export interface FulfillmentAllocationOut {
  id: number;
  version_no: number;
  effective_from_issue: number | null;
  effective_until_issue: number | null;
  change_reason: string | null;
  created_at: string;
  targets: FulfillmentTargetOut[];
}

export interface FulfillmentProgress {
  expected_at_creation: number | null;
  current_expected: number | null;
  drift: number | null;
  synced_count: number;
  skipped_count: number;
}

export interface OrderItemOut {
  id: number;
  publication: Publication;
  publication_format: PublicationFormat;
  fulfillment_type: FulfillmentType;
  billing_type: BillingType;
  subscription_term: SubscriptionTerm | null;
  delivery_method: DeliveryMethod | null;
  term_start_month: string | null;
  coverage_start_date: string | null;
  coverage_end_date: string | null;
  issue_number: number | null;
  total_quantity: number;
  unit_price: string;
  subtotal: string;
  expected_issues_at_creation: number | null;
  status: OrderItemStatus;
  notes: string | null;
  allocations: FulfillmentAllocationOut[];
  progress: FulfillmentProgress;
}

export interface OrderEventOut {
  id: number;
  event_type: OrderEventType;
  payload_json: Record<string, unknown> | null;
  operator_id: number | null;
  created_at: string;
}

export interface RefundOut {
  id: number;
  order_item_id: number | null;
  amount: string;
  reason: string | null;
  stop_from_issue: number | null;
  refunded_at: string;
  operator_id: number | null;
  created_at: string;
}

export interface OrderOut {
  id: number;
  order_code: string | null;
  external_order_no: string | null;
  order_date: string;
  entry_method: OrderEntryMethod;
  source_platform: string | null;
  source_store: string | null;
  campaign: string | null;
  payer_name: string;
  payer_contact: string | null;
  payment_method: OrderPaymentMethod | null;
  payment_collector: string | null;
  total_amount: string;
  paid_amount: string;
  invoice_required: boolean;
  invoice_title: string | null;
  invoice_tax_no: string | null;
  invoice_recipient_email: string | null;
  status: OrderStatus;
  commercial_status: OrderCommercialStatus | null;
  refunded_amount: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  items: OrderItemOut[];
  refunds: RefundOut[];
}

export interface OrderListRow {
  id: number;
  order_code: string | null;
  external_order_no: string | null;
  order_date: string;
  payer_name: string;
  entry_method: OrderEntryMethod;
  source_platform: string | null;
  campaign: string | null;
  total_quantity: number;
  total_amount: string;
  coverage_start_date: string | null;
  coverage_end_date: string | null;
  status: OrderStatus;
  commercial_status: OrderCommercialStatus | null;
  refunded_amount: string;
  has_drift: boolean;
  synced_count: number;
  expected_total: number | null;
}

export interface ListOrdersResponse {
  rows: OrderListRow[];
  total: number;
}

export interface PricingPreviewPayload {
  subscription_term: Exclude<SubscriptionTerm, 'custom'>;
  delivery_method: DeliveryMethod;
  term_start_month: string;
  total_quantity: number;
}

export interface PricingPreviewOut {
  month_range_label: string;
  coverage_start_date: string;
  coverage_end_date: string;
  expected_issue_count: number;
  unit_price: string;
  subtotal: string;
  price_label: string;
  schedule_incomplete: boolean;
  warning: string | null;
}

export interface OrderShippingSyncSummary {
  candidates: number;
  to_create: number;
  to_update: number;
  skipped: number;
  conflicts: number;
}

export type OrderShippingSyncAction = 'create' | 'update' | 'skip' | 'conflict';

export interface OrderShippingSyncItem {
  action: OrderShippingSyncAction;
  order_id: number;
  order_item_id: number | null;
  fulfillment_target_id: number | null;
  shipping_detail_id: number | null;
  name: string | null;
  quantity: number | null;
  reason: string | null;
  diff: Record<string, unknown> | null;
}

export interface OrderShippingSyncPreview {
  order_id: number;
  issue_number: number;
  summary: OrderShippingSyncSummary;
  items: OrderShippingSyncItem[];
  message: string | null;
}

// =============================================================================
// Query params
// =============================================================================

export interface ListOrdersParams {
  status?: OrderStatus;
  entry_method?: OrderEntryMethod;
  payer_name_like?: string;
  campaign?: string;
  source_platform?: string;
  coverage_start?: string;
  coverage_end?: string;
  order_date_start?: string;
  order_date_end?: string;
  has_drift?: boolean;
  skip?: number;
  limit?: number;
}

// =============================================================================
// API client functions
// =============================================================================

export const listOrders = (
  params?: ListOrdersParams,
): Promise<AxiosResponse<ListOrdersResponse>> =>
  api.get<ListOrdersResponse>('/orders', { params });

export const getOrder = (id: number): Promise<AxiosResponse<OrderOut>> =>
  api.get<OrderOut>(`/orders/${id}`);

export const createOrder = (
  payload: OrderCreatePayload,
): Promise<AxiosResponse<OrderOut>> => api.post<OrderOut>('/orders', payload);

export const updateOrder = (
  id: number,
  payload: OrderUpdatePayload,
): Promise<AxiosResponse<OrderOut>> =>
  api.put<OrderOut>(`/orders/${id}`, payload);

export const confirmOrder = (id: number): Promise<AxiosResponse<OrderOut>> =>
  api.post<OrderOut>(`/orders/${id}/confirm`);

export const voidOrder = (
  id: number,
  reason: string,
): Promise<AxiosResponse<OrderOut>> =>
  api.post<OrderOut>(`/orders/${id}/void`, { reason } satisfies OrderVoidPayload);

export const refundOrder = (
  id: number,
  payload: RefundPayload,
): Promise<AxiosResponse<OrderOut>> =>
  api.post<OrderOut>(`/orders/${id}/refund`, payload);

export const cancelOrder = (
  id: number,
  reason: string,
): Promise<AxiosResponse<OrderOut>> =>
  api.post<OrderOut>(`/orders/${id}/cancel`, { reason } satisfies OrderCancelPayload);

export const listOrderEvents = (
  id: number,
): Promise<AxiosResponse<OrderEventOut[]>> =>
  api.get<OrderEventOut[]>(`/orders/${id}/events`);

export const updateOrderItems = (
  id: number,
  payload: OrderItemsUpdatePayload,
): Promise<AxiosResponse<OrderOut>> =>
  api.put<OrderOut>(`/orders/${id}/items`, payload);

export function previewOrderPricing(
  payload: PricingPreviewPayload,
): Promise<AxiosResponse<PricingPreviewOut>> {
  return api.post('/orders/pricing-preview', payload);
}

export const getOrderProgress = (
  id: number,
): Promise<AxiosResponse<FulfillmentProgress[]>> =>
  api.get<FulfillmentProgress[]>(`/orders/${id}/fulfillment-progress`);

export const previewOrderShippingSync = (
  orderId: number,
  issueNumber: number,
): Promise<AxiosResponse<OrderShippingSyncPreview>> =>
  api.get<OrderShippingSyncPreview>(`/orders/${orderId}/shipping-sync/preview`, {
    params: { issue_number: issueNumber },
  });

export const applyOrderShippingSync = (
  orderId: number,
  issueNumber: number,
): Promise<AxiosResponse<OrderShippingSyncPreview>> =>
  api.post<OrderShippingSyncPreview>(`/orders/${orderId}/shipping-sync/apply`, {
    issue_number: issueNumber,
  });

// =============================================================================
// TanStack Query keys (centralised so invalidation stays consistent)
// =============================================================================

export const orderQueryKeys = {
  all: ['orders'] as const,
  lists: () => [...orderQueryKeys.all, 'list'] as const,
  list: (params?: ListOrdersParams) =>
    [...orderQueryKeys.lists(), params ?? {}] as const,
  details: () => [...orderQueryKeys.all, 'detail'] as const,
  detail: (id: number) => [...orderQueryKeys.details(), id] as const,
  events: (id: number) => [...orderQueryKeys.detail(id), 'events'] as const,
  progress: (id: number) => [...orderQueryKeys.detail(id), 'progress'] as const,
};
