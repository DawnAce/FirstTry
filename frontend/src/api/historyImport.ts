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
  shipping_issue_source: string;
  publish_date: string;
  page_count: number;
  report_entry_count: number;
  temp_detail_count: number;
  shipping_detail_count: number;
  shipping_fixed_detail_count: number;
  shipping_fixed_quantity: number;
  shipping_resulting_detail_count: number;
  shipping_resulting_quantity: number;
  readiness: CommitReadiness;
  errors: string[];
  warnings: string[];
  can_commit: boolean;
  import_session_id: string;
  manual_temp_print_required_quantity: number;
  manual_temp_print_self_quantity: number;
  manual_temp_rows: TempPrintDetailDraft[];
  report_rows: HistoryReportRow[];
  source_total: number;
  mapped_total: number;
  unmapped_report_items: UnmappedReportItem[];
  report_mapping_options: ReportMappingOption[];
}

export interface HistoryReportRow {
  category: string;
  display_name: string;
  sub_category: string;
  destination: string;
  is_variable: boolean;
  value: number;
}

export interface UnmappedReportItem {
  item_id: string;
  sheet_name: string;
  source_label: string;
  cell_reference: string;
  value: number;
}

export interface ReportMappingOption {
  category: string;
  sub_category: string;
  display_name: string;
}

export interface ManualReportMappingDraft {
  item_id: string;
  category: string;
  sub_category: string;
}

export interface TempPrintDetailDraft {
  department: string;
  custom_name?: string | null;
  quantity: number;
  self_quantity: number;
}

export interface HistoryImportCommitResult {
  issue_id: number;
  issue_number: number;
  report_entry_count: number;
  temp_detail_count: number;
  shipping_detail_count: number;
  schedule_page_count_updated: boolean;
  previous_schedule_page_count: number | null;
  new_page_count: number | null;
}

export const downloadReportTemplate = (): Promise<AxiosResponse<Blob>> =>
  api.get<Blob>('/history-import/templates/report', { responseType: 'blob' });

export const downloadShippingTemplate = (): Promise<AxiosResponse<Blob>> =>
  api.get<Blob>('/history-import/templates/shipping', { responseType: 'blob' });

export const previewHistoryImport = (
  reportFile: File,
  shippingFile: File,
  reportPassword?: string,
): Promise<AxiosResponse<HistoryImportPreview>> => {
  const form = new FormData();
  form.append('report_file', reportFile);
  form.append('shipping_file', shippingFile);
  const normalizedPassword = reportPassword?.trim();
  if (normalizedPassword) {
    form.append('report_password', normalizedPassword);
  }
  return api.post<HistoryImportPreview>('/history-import/preview', form);
};

export const commitHistoryImport = (
  importSessionId: string,
  manualTempRows?: TempPrintDetailDraft[],
  manualReportMappings?: ManualReportMappingDraft[],
): Promise<AxiosResponse<HistoryImportCommitResult>> =>
  api.post<HistoryImportCommitResult>('/history-import/commit', {
    import_session_id: importSessionId,
    manual_temp_rows: manualTempRows,
    manual_report_mappings: manualReportMappings,
  });
