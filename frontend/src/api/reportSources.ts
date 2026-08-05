import api from './client';

export type ReportSourceChannel = 'postal' | 'retail' | 'guangzhou' | 'chengdu';
export type ReportSourceDocumentType = 'weekly' | 'monthly' | 'adjustment';
export type ReportSourceStatus = 'pending_review' | 'channel_pending' | 'confirmed';
export type ReportSourceItemKind = 'base' | 'adjustment';
export type ReportSourceAdjustmentKind = 'billable_addition' | 'replacement' | 'reduction';

export interface ReportSourceSuggestion {
  issue_number: number | null;
  source_period: string | null;
  item_kind: ReportSourceItemKind;
  category: ReportSourceChannel;
  sub_category: string;
  source_label: string | null;
  source_quantity: number | null;
  applied_quantity: number | null;
  source_status: ReportSourceStatus;
  adjustment_kind: ReportSourceAdjustmentKind | null;
  confidence: number | null;
  notes: string | null;
}

export interface ReportSourceItem {
  id: number;
  document_id: number;
  issue_number: number;
  item_kind: ReportSourceItemKind;
  category: string;
  sub_category: string;
  source_label: string | null;
  source_quantity: number | null;
  applied_quantity: number | null;
  source_status: ReportSourceStatus;
  adjustment_kind: ReportSourceAdjustmentKind | null;
  settlement_delta: number;
  shipping_delta: number;
  shipped_quantity: number;
  tracking_no: string | null;
  shipped_at: string | null;
  notes: string | null;
  confirmed_at: string | null;
  created_at: string;
}

export interface ReportSourceDocument {
  id: number;
  channel: ReportSourceChannel;
  document_type: ReportSourceDocumentType;
  original_filename: string;
  display_name: string;
  mime_type: string | null;
  size: number;
  sha256: string;
  source_date: string | null;
  extraction_status: 'pending_review' | 'reviewed' | 'confirmed';
  extraction_json: {
    warnings?: string[];
    raw_text?: string;
    source_date?: string | null;
  } | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
  items: ReportSourceItem[];
}

export interface ReportSourceUpload extends ReportSourceDocument {
  suggestions: ReportSourceSuggestion[];
  duplicate: boolean;
}

export interface ChannelSourceSummary {
  channel: string;
  document_count: number;
  base_quantity: number;
  settlement_delta: number;
  settlement_total: number;
  shipping_delta: number;
  shipped_quantity: number;
  pending_shipping: number;
  pending_count: number;
}

export interface IssueSourceSummary {
  issue_number: number;
  document_count: number;
  documents: ReportSourceDocument[];
  channels: ChannelSourceSummary[];
}

export interface ReportSourceConfirmItem {
  issue_number: number;
  item_kind: ReportSourceItemKind;
  category: ReportSourceChannel;
  sub_category: string;
  source_label?: string | null;
  source_quantity?: number | null;
  applied_quantity?: number | null;
  source_status: ReportSourceStatus;
  adjustment_kind?: ReportSourceAdjustmentKind | null;
  notes?: string | null;
}

export const getIssueReportSources = (issueId: number) =>
  api.get<IssueSourceSummary>(`/report-sources/issues/${issueId}`);

export const uploadReportSource = (
  file: File,
  channel: ReportSourceChannel,
  issueNumber: number,
  documentType: ReportSourceDocumentType,
) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('channel', channel);
  formData.append('issue_number', String(issueNumber));
  formData.append('document_type', documentType);
  return api.post<ReportSourceUpload>('/report-sources/upload', formData);
};

export const confirmReportSource = (documentId: number, items: ReportSourceConfirmItem[]) =>
  api.post<ReportSourceDocument>(`/report-sources/${documentId}/confirm`, {
    items,
    apply_base_values: true,
  });

export const deleteReportSource = (documentId: number) =>
  api.delete(`/report-sources/${documentId}`);

export async function downloadReportSource(documentId: number, filename: string) {
  const response = await api.get<Blob>(`/report-sources/${documentId}/download`, { responseType: 'blob' });
  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export const updateReportSourceShipping = (
  itemId: number,
  data: { shipped_quantity: number; tracking_no?: string | null; shipped_at?: string | null },
) => api.patch<ReportSourceItem>(`/report-sources/items/${itemId}/shipping`, data);
