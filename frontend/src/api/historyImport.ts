import type { AxiosResponse } from 'axios';
import api from './client';

export interface CommitReadiness {
  same_issue: boolean;
  issue_exists: boolean;
  can_commit: boolean;
  errors: string[];
}

export interface HistoryImportPreview {
  issue_number: number;
  publish_date: string;
  report_entry_count: number;
  temp_detail_count: number;
  shipping_detail_count: number;
  readiness: CommitReadiness;
  errors: string[];
  can_commit: boolean;
  import_session_id: string;
}

export interface HistoryImportCommitResult {
  issue_id: number;
  issue_number: number;
  report_entry_count: number;
  temp_detail_count: number;
  shipping_detail_count: number;
}

export const downloadReportTemplate = (): Promise<AxiosResponse<Blob>> =>
  api.get<Blob>('/history-import/templates/report', { responseType: 'blob' });

export const downloadShippingTemplate = (): Promise<AxiosResponse<Blob>> =>
  api.get<Blob>('/history-import/templates/shipping', { responseType: 'blob' });

export const previewHistoryImport = (
  reportFile: File,
  shippingFile: File,
): Promise<AxiosResponse<HistoryImportPreview>> => {
  const form = new FormData();
  form.append('report_file', reportFile);
  form.append('shipping_file', shippingFile);
  return api.post<HistoryImportPreview>('/history-import/preview', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

export const commitHistoryImport = (
  importSessionId: string,
): Promise<AxiosResponse<HistoryImportCommitResult>> =>
  api.post<HistoryImportCommitResult>('/history-import/commit', {
    import_session_id: importSessionId,
  });
