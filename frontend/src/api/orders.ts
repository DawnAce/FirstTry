import type { AxiosResponse } from 'axios';
import api from './client';

// =============================================================================
// Enums (mirror backend Pydantic / SQLAlchemy enums)
// =============================================================================

export type OrderStatus = 'draft' | 'pending_confirmation' | 'active' | 'void';

export type OrderSourceType =
  | 'ecommerce'
  | 'corporate_transfer'
  | 'vip_gift'
  | 'manual'
  | 'mail_annual';

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
  source_type: OrderSourceType;
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
  notes?: string | null;
  items: OrderItemIn[];
}

export interface OrderUpdatePayload {
  order_date?: string;
  source_type?: OrderSourceType;
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
  notes?: string | null;
}

export interface OrderVoidPayload {
  reason: string;
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

export interface OrderOut {
  id: number;
  order_code: string | null;
  external_order_no: string | null;
  order_date: string;
  source_type: OrderSourceType;
  source_platform: string | null;
  source_store: string | null;
  payer_name: string;
  payer_contact: string | null;
  payment_method: OrderPaymentMethod | null;
  payment_collector: string | null;
  total_amount: string;
  paid_amount: string;
  invoice_required: boolean;
  invoice_title: string | null;
  status: OrderStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  items: OrderItemOut[];
}

export interface OrderListRow {
  id: number;
  order_code: string | null;
  external_order_no: string | null;
  order_date: string;
  payer_name: string;
  source_type: OrderSourceType;
  source_platform: string | null;
  total_quantity: number;
  total_amount: string;
  coverage_start_date: string | null;
  coverage_end_date: string | null;
  status: OrderStatus;
  has_drift: boolean;
  synced_count: number;
  expected_total: number | null;
}

export interface ListOrdersResponse {
  rows: OrderListRow[];
  total: number;
}

// =============================================================================
// Query params
// =============================================================================

export interface ListOrdersParams {
  status?: OrderStatus;
  source_type?: OrderSourceType;
  payer_name_like?: string;
  coverage_start?: string;
  coverage_end?: string;
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

export const listOrderEvents = (
  id: number,
): Promise<AxiosResponse<OrderEventOut[]>> =>
  api.get<OrderEventOut[]>(`/orders/${id}/events`);

export const getOrderProgress = (
  id: number,
): Promise<AxiosResponse<FulfillmentProgress[]>> =>
  api.get<FulfillmentProgress[]>(`/orders/${id}/fulfillment-progress`);

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
