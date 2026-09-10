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
  versions: { revision: number; snapshot: SourceSnapshot; created_at: string }[];
}

export const sourceQueryKeys = {
  all: ['order-sources'] as const,
  list: (params: object) => ['order-sources', 'list', params] as const,
  detail: (id: number | null) => ['order-sources', 'detail', id] as const,
};
export const listOrderSources = (params: { search?: string; pending?: boolean; order_id?: number; skip?: number; limit?: number }) =>
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
