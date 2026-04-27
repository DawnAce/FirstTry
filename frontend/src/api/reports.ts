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

export const getReport = (issueId: number) =>
  api.get<ReportData>(`/issues/${issueId}/report`);

export const updateReport = (issueId: number, entries: { category: string; sub_category: string; value: number }[]) =>
  api.put(`/issues/${issueId}/report`, { entries });

export const confirmReport = (issueId: number) =>
  api.post(`/issues/${issueId}/report/confirm`);
