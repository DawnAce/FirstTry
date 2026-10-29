import api from './client';

export type DemandKind = 'order' | 'report';
export type DemandCycle = 'month' | 'week' | 'biweek' | 'custom' | 'fixed';
export type ReviewStatus = 'confirmed' | 'pending' | 'none';
export interface DemandLine {
  issue_number: number;
  sub_category: string;
  quantity: number | null;
  review_status: ReviewStatus;
  id?: number;
  publish_date?: string;
  unit_price?: string | null;
}
export interface DemandInput {
  partner_id: number;
  contract_id?: number | null;
  category: string;
  document_type: DemandKind;
  cycle: DemandCycle;
  received_date: string;
  transport: 'zto' | 'channel' | 'pending';
  recipient_name?: string | null;
  recipient_phone?: string | null;
  recipient_address?: string | null;
  pricing_mode: 'unpriced' | 'chengdu_annual';
  notes?: string | null;
  lines: DemandLine[];
  version: number;
}
export interface PricingBasis {
  year: number;
  annual_price: string;
  issue_count: number;
  discount: string;
  unit_price: string;
  schedule_fingerprint: string;
}
export interface DemandAttachment {
  id: number;
  filename: string;
  extraction: { raw_text?: string; warnings?: string[]; suggestions?: Record<string, unknown>[] } | null;
  reviewed_version: number | null;
}
export interface Demand extends Omit<DemandInput, 'pricing_mode'> {
  id: number;
  partner_name: string;
  display_name: string;
  status: 'draft' | 'confirmed' | 'superseded';
  supersedes_id: number | null;
  confirmed_at: string | null;
  pricing: Record<string, PricingBasis> | null;
  estimated_amount?: string | null;
  attachments: DemandAttachment[];
}
export interface DemandOptions {
  partners: { id: number; name: string; legal_name?: string; display_name: string; category: string | null; cycle: DemandCycle; document_type: DemandKind; transport: DemandInput['transport']; chengdu: boolean }[];
  contracts: { id: number; partner_id: number; title: string | null }[];
  templates: { category: string; sub_category: string; display_name: string }[];
}
export interface DemandTrace {
  line_id: number;
  issue_number: number;
  sub_category: string;
  issue_id: number | null;
  print_status: string;
  adopted_quantity: number | null;
  adopted_version: number | null;
  adopted_demand_id?: number | null;
}
export interface DemandPrintPreview {
  issue_number: number;
  token: string;
  can_apply: boolean;
  rows: { category: string; sub_category: string; quantity: number; current_quantity: number | null; fingerprint: string; adopted: boolean; errors: string[];
    sources: { demand_id: number; version: number; display_name: string; quantity: number | null; review_status: ReviewStatus }[] }[];
}
export interface DemandFilters { partner_id?: number; status?: string; document_type?: string; skip?: number; limit?: number }
export const demandKeys = {
  all: ['channelDemands'] as const,
  options: ['channelDemands', 'options'] as const,
  detail: (id: number) => ['channelDemands', 'detail', id] as const,
  trace: (id: number) => ['channelDemands', 'trace', id] as const,
  print: (id: number) => ['channelDemands', 'print', id] as const,
};
export const getDemandOptions = () => api.get<DemandOptions>('/channel-demands/options');
export const listDemands = (params: DemandFilters) => api.get<{ total: number; items: Demand[] }>('/channel-demands', { params });
export const getDemand = (id: number) => api.get<Demand>(`/channel-demands/${id}`);
export const saveDemand = (body: DemandInput, id?: number) => id ? api.put<Demand>(`/channel-demands/${id}`, body) : api.post<Demand>('/channel-demands', body);
export const confirmDemand = (id: number, version: number) => api.post<Demand>(`/channel-demands/${id}/confirm`, { version, reviewed: true });
export const reviseDemand = (id: number, version: number) => api.post<Demand>(`/channel-demands/${id}/revise`, { version });
export const getDemandTrace = (id: number) => api.get<DemandTrace[]>(`/channel-demands/${id}/trace`);
export const getDemandPrint = (id: number) => api.get<DemandPrintPreview>(`/channel-demands/print/${id}`);
export const applyDemandPrint = (id: number, token: string) => api.post<DemandPrintPreview>(`/channel-demands/print/${id}/apply`, { token });
export const uploadDemandAttachment = (id: number, version: number, file: File) => {
  const body = new FormData();
  body.append('version', String(version));
  body.append('file', file);
  return api.post<Demand>(`/channel-demands/${id}/attachments`, body);
};
export const downloadDemandAttachment = (id: number, attachmentId: number) => api.get<Blob>(`/channel-demands/${id}/attachments/${attachmentId}/download`, { responseType: 'blob' });
