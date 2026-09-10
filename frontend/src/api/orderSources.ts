import api from './client';
import type { Publication } from './orders';

export interface SourceSnapshot {
  filename?: string | null;
  source_sheet?: string;
  source_row?: number;
  recipient_name: string;
  recipient_phone: string;
  recipient_address: string;
  notes: string;
  order_date: string | null;
  payment_time?: string | null;
  status_raw: string;
  paid_amount: string;
  product_lines: { raw: string; name: string; quantity: number; unit_price: string; is_shipping: boolean }[];
  raw_cells?: Record<string, string>;
}

export interface SourceLink {
  id: number;
  order_id: number;
  order_item_id: number | null;
  target_id: number | null;
  amount: string;
  refund_amount?: string | null;
  active: number;
  delivery_from_issue: number | null;
  reason: string;
}

export interface OrderSource {
  id: number;
  platform: string;
  store: string;
  external_order_no: string;
  kind: string;
  revision: number;
  version: number;
  order_date: string | null;
  commercial_status: string | null;
  paid_amount: string;
  verified_refund_amount: string | null;
  verified_refund_date: string | null;
  finance_note: string | null;
  snapshot: SourceSnapshot;
  links: SourceLink[];
  allocation_valid?: boolean;
  refund_pending?: boolean;
  net_amount?: string | null;
  events?: { id: number; action: string; payload: Record<string, unknown>; operator_id: number | null; created_at: string }[];
  delivery_changes?: SourceDeliveryChange[];
  versions: { revision: number; snapshot: SourceSnapshot; created_at: string }[];
}

export const sourceQueryKeys = {
  all: ['order-sources'] as const,
  list: (params: object) => ['order-sources', 'list', params] as const,
  detail: (id: number | null) => ['order-sources', 'detail', id] as const,
};
export const listOrderSources = (params: { search?: string; pending?: boolean; order_id?: number; kind?: string; skip?: number; limit?: number }) =>
  api.get<{ rows: OrderSource[]; total: number }>('/order-sources', { params });
export const getOrderSource = (id: number) => api.get<OrderSource>(`/order-sources/${id}`);

export interface SourceCandidate {
  order_id: number;
  order_code: string | null;
  external_order_no: string | null;
  order_date: string;
  order_item_id: number;
  target_id: number;
  publication: Publication;
  recipient_name: string;
  recipient_phone: string | null;
  recipient_address: string;
  coverage_start_date: string | null;
  coverage_end_date: string | null;
  confidence: 'high' | 'possible';
  evidence: string[];
  expected_target_version: string;
}
export interface SourceAllocation {
  order_id: number;
  order_item_id: number;
  target_id: number;
  amount: string;
  expected_target_version: string;
}
export interface SourceLinkPayload {
  version: number;
  reason: string;
  allocations: SourceAllocation[];
}
export const getSourceCandidates = (id: number, search?: string) => api.get<{ rows: SourceCandidate[]; truncated: boolean }>(`/order-sources/${id}/candidates`, { params: { search } });
export const previewSourceLinks = (id: number, body: SourceLinkPayload) => api.post<{ can_apply: boolean; total_amount: string; warnings: string[] }>(`/order-sources/${id}/link-preview`, body);
export const saveSourceLinks = (id: number, body: SourceLinkPayload) => api.put<OrderSource>(`/order-sources/${id}/links`, body);

export interface SourceFinanceSummary {
  fee_count: number;
  fee_paid_amount: string;
  fee_refunded_amount: string;
  fee_net_amount: string | null;
  unresolved_count: number;
  subscription_paid_amount: string | null;
  subscription_refunded_amount: string | null;
  combined_net_amount: string | null;
}
export interface SourceRefundPayload {
  version: number;
  reason: string;
  amount: string;
  refunded_at: string | null;
  allocations: { link_id: number; amount: string }[];
}
export interface SourceDeliveryPayload {
  version: number;
  reason: string;
  link_id: number;
  effective_from_issue: number;
  shipping_channel: 'zto_outsource' | 'post_office';
  postal_delivery_ids: number[];
  postal_confirmed: boolean;
  expected_state?: string;
}
export interface SourceDeliveryReview {
  expected_state: string;
  effective_date: string;
  postal_until_date: string;
  order_id: number;
  target_id: number;
  recipient_name: string;
  from_channel: string;
  to_channel: string;
  postal_records: { id: number; delivery_no: string; recipient_name: string; recipient_phone: string | null; recipient_address: string; start: string | null; end: string | null; required: boolean; selected: boolean }[];
  warnings: string[];
}
export interface SourceDeliveryChange {
  id: number;
  link_id: number;
  from_target_id: number;
  to_target_id: number;
  effective_from_issue: number;
  effective_date: string;
  status: string;
  reason: string;
}
export interface SourceDeliveryUndoPayload { version: number; reason: string; change_id: number; expected_state?: string }
export const getSourceFinanceSummary = (orderId?: number) => api.get<SourceFinanceSummary>('/order-sources/financial-summary', { params: { order_id: orderId } });
export const previewSourceRefund = (id: number, body: SourceRefundPayload) => api.post(`/order-sources/${id}/refund-preview`, body);
export const saveSourceRefund = (id: number, body: SourceRefundPayload) => api.put<OrderSource>(`/order-sources/${id}/refund`, body);
export const getSourceDeliveryOptions = (id: number, linkId: number) => api.get<{ target_id: number; recipient_name: string; shipping_channel: string; issues: { issue_number: number; publish_date: string }[] }>(`/order-sources/${id}/delivery-options`, { params: { link_id: linkId } });
export const previewSourceDelivery = (id: number, body: SourceDeliveryPayload) => api.post<SourceDeliveryReview>(`/order-sources/${id}/delivery-preview`, body);
export const saveSourceDelivery = (id: number, body: SourceDeliveryPayload) => api.post<OrderSource>(`/order-sources/${id}/delivery`, body);
export const previewSourceDeliveryUndo = (id: number, body: SourceDeliveryUndoPayload) => api.post<{ expected_state: string; message: string }>(`/order-sources/${id}/delivery-undo-preview`, body);
export const saveSourceDeliveryUndo = (id: number, body: SourceDeliveryUndoPayload) => api.post<OrderSource>(`/order-sources/${id}/delivery-undo`, body);
