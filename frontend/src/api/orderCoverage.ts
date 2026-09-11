import api from './client';

export interface CoverageCandidate {
  key: string;
  order_id: number | null;
  external_order_no: string | null;
  order_date: string;
  source_platform: string | null;
  recipient_name: string;
  publication: string;
  subscription_term: string | null;
  delivery_method: string | null;
  coverage_start_date: string | null;
  coverage_end_date: string | null;
  version: string;
  blocked_reason: string | null;
}

export interface CoverageFilters {
  import_session_id?: string;
  order_ids?: number[];
  source_platform?: string;
  publication?: string;
  delivery_method?: string;
  order_date_start?: string;
  order_date_end?: string;
  missing_only?: boolean;
  skip?: number;
  limit?: number;
}

export interface CoverageChange {
  key: string;
  expected_version: string;
  coverage_start_date: string;
  coverage_end_date: string;
}

export interface CoveragePreviewRow {
  key: string;
  external_order_no: string | null;
  publication: string | null;
  old_start: string | null;
  old_end: string | null;
  new_start: string;
  new_end: string;
  error: string | null;
}

export interface CoveragePreview {
  preview_id: string | null;
  can_apply: boolean;
  rows: CoveragePreviewRow[];
  order_count: number;
}

export interface CoverageApplyResult {
  import_version?: number | null;
  updated: number;
  order_count: number;
  changes: CoverageChange[];
}

export const coverageQueryKey = ['order-coverage'] as const;

export async function getCoverageCandidates(filters: CoverageFilters) {
  return (await api.get<{ rows: CoverageCandidate[]; total: number; order_count: number }>(
    '/order-coverage/candidates', { params: filters, paramsSerializer: { indexes: null } },
  )).data;
}

export async function previewCoverage(changes: CoverageChange[], reason: string, importSessionId?: string) {
  return (await api.post<CoveragePreview>('/order-coverage/preview', {
    changes, reason, import_session_id: importSessionId,
  })).data;
}

export async function applyCoverage(previewId: string) {
  return (await api.post<CoverageApplyResult>('/order-coverage/apply', { preview_id: previewId })).data;
}
