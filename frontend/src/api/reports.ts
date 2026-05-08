import api from './client';

export interface ReportEntry {
  id: number;
  category: string;
  sub_category: string;
  value: number;
  is_variable: boolean;
}

export interface ReportData {
  issue_id: number;
  issue_number: number;
  entries: ReportEntry[];
  total: number;
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
  api.post(`/issues/${issueId}/report/confirm`);

export const revokeReport = (issueId: number, reason?: string) =>
  api.post(`/issues/${issueId}/report/revoke`, null, { params: { reason } });

export const getRevisions = (issueId: number) =>
  api.get<RevisionRecord[]>(`/issues/${issueId}/report/revisions`);

export const getTempPrintDetails = (issueId: number) =>
  api.get<TempPrintDetail[]>(`/issues/${issueId}/report/temp-details`);

export const updateTempPrintDetails = (issueId: number, details: TempPrintDetail[]) =>
  api.put<TempPrintDetail[]>(`/issues/${issueId}/report/temp-details`, details);
