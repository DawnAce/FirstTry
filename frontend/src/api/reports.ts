import api from './client';

export interface ReportEntry {
  id: number;
  category: string;
  sub_category: string;
  value: number;
  is_variable: boolean;
  destination: string | null;
}

export interface DestinationSummary {
  destination: string;
  total: number;
}

export interface ConfirmationSummary {
  confirmed_report_total: number;
  confirmed_shipping_total: number;
  confirmed_delta: number;
  confirmed_is_match: boolean;
  current_shipping_total: number;
  current_delta: number;
  current_is_match: boolean;
  has_shipping_drift: boolean;
}

export interface ReportData {
  issue_id: number;
  issue_number: number;
  entries: ReportEntry[];
  total: number;
  destination_summary: DestinationSummary[];
  confirmation_summary?: ConfirmationSummary | null;
  // 实时一致性预警：报数「中通物流公司」合计 vs 当期发货明细合计。
  shipping_check?: {
    is_match: boolean;
    report_zt_total: number;
    shipping_total: number;
    delta: number;
  } | null;
}

export interface ConfirmReportResponse {
  message: string;
  issue_number: number;
  shipping_details_copied?: number;
  zt_report_total?: number;
  zt_shipping_total?: number;
  warning?: string;
}

export interface RevisionRecord {
  id: number;
  revision_number: number;
  operator: string;
  reason: string | null;
  changes_json: { category: string; sub_category: string; value: number }[];
  confirmed_at: string | null;
  revoked_at: string | null;
}

export interface TempPrintDetail {
  id?: number;
  department: string;
  custom_name?: string | null;
  quantity: number;
  self_quantity: number;
}

export const getReport = (issueId: number) =>
  api.get<ReportData>(`/issues/${issueId}/report`);

export const updateReport = (issueId: number, entries: { category: string; sub_category: string; value: number }[]) =>
  api.put(`/issues/${issueId}/report`, { entries });

export const confirmReport = (issueId: number) =>
  api.post<ConfirmReportResponse>(`/issues/${issueId}/report/confirm`);

export const revokeReport = (issueId: number, reason?: string) =>
  api.post(`/issues/${issueId}/report/revoke`, null, { params: { reason } });

export const getRevisions = (issueId: number) =>
  api.get<RevisionRecord[]>(`/issues/${issueId}/report/revisions`);

export const getTempPrintDetails = (issueId: number) =>
  api.get<TempPrintDetail[]>(`/issues/${issueId}/report/temp-details`);

export const updateTempPrintDetails = (issueId: number, details: TempPrintDetail[]) =>
  api.put<TempPrintDetail[]>(`/issues/${issueId}/report/temp-details`, details);
