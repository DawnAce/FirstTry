import type { AxiosResponse } from 'axios';
import api from './client';

export type PostalBatchStatus = 'draft' | 'generated' | 'sent';

export interface PostalBatch {
  id: number;
  year: number;
  month: number;
  status: PostalBatchStatus;
  generated_at: string | null;
  sent_at: string | null;
  row_count: number;
}

export interface PostalBatchRow {
  id: number;
  snap_name: string;
  snap_phone: string | null;
  snap_province: string | null;
  snap_city: string | null;
  snap_district: string | null;
  snap_address: string;
  snap_postal_code: string | null;
  copies: number;
  coverage_start_date: string | null;
  coverage_end_date: string | null;
  source_channel: string | null;
  distribution_unit_id: number | null;
  distribution_unit_name: string | null;
  salesperson: string | null;
}

export interface PostalBatchDetail {
  batch: PostalBatch;
  rows: PostalBatchRow[];
}

export type PostalImportDecision = 'import' | 'duplicate' | 'unresolved';

export interface PostalImportRow {
  external_order_no: string;
  name: string;
  amount: string;
  decision: PostalImportDecision;
  coverage_label: string;
  distribution_unit: string;
  reason: string | null;
  warnings: string[];
}

export interface PostalImportPreview {
  session_id: string;
  counts: Record<string, number>;
  can_commit: boolean;
  rows: PostalImportRow[];
}

export interface PostalCommitOut {
  created: number;
  order_ids: number[];
  skipped_duplicates: number;
}

export function previewPostalImport(file: File): Promise<AxiosResponse<PostalImportPreview>> {
  const fd = new FormData();
  fd.append('file', file);
  return api.post('/postal/import/preview', fd);
}

export function commitPostalImport(sessionId: string): Promise<AxiosResponse<PostalCommitOut>> {
  return api.post('/postal/import/commit', { session_id: sessionId });
}

export function listPostalBatches(): Promise<AxiosResponse<PostalBatch[]>> {
  return api.get('/postal/batches');
}

export function generatePostalBatch(year: number, month: number): Promise<AxiosResponse<PostalBatch>> {
  return api.post('/postal/batches/generate', { year, month });
}

export function getPostalBatch(id: number): Promise<AxiosResponse<PostalBatchDetail>> {
  return api.get(`/postal/batches/${id}`);
}

export function markPostalBatchSent(id: number): Promise<AxiosResponse<PostalBatch>> {
  return api.post(`/postal/batches/${id}/mark-sent`);
}

/** 导出走 JWT，需取 blob 再触发下载（不能直接 window.open）。 */
export async function downloadPostalBatch(id: number, filename: string): Promise<void> {
  const res = await api.get(`/postal/batches/${id}/export`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// --- 投诉工单 (P2) ---------------------------------------------------------

export type PostalComplaintStatus = 'open' | 'resolved';

export interface PostalComplaint {
  id: number;
  order_id: number | null;
  external_order_no: string | null;
  complaint_date: string | null;
  year: number | null;
  missing_issues: string | null;
  handling: string | null;
  routed_label: string | null;
  routed_unit_id: number | null;
  routed_unit_name: string | null;
  follow_up: string | null;
  handling_count: number | null;
  status: PostalComplaintStatus;
  first_handler: string | null;
  snap_name: string | null;
  snap_phone: string | null;
  snap_address: string | null;
  snap_postal_code: string | null;
  notes: string | null;
}

export interface ComplaintListOut {
  rows: PostalComplaint[];
  total: number;
}

export interface ComplaintFilters {
  year?: number;
  status?: string;
  min_handling_count?: number;
  search?: string;
  page?: number;
  page_size?: number;
}

export interface ComplaintImportRow {
  external_order_no: string;
  name: string;
  complaint_date: string | null;
  missing_issues: string;
  decision: 'import' | 'duplicate';
  linked: boolean;
  routed_label: string | null;
  distribution_unit: string;
  status: string;
}

export interface ComplaintImportPreview {
  session_id: string;
  counts: Record<string, number>;
  can_commit: boolean;
  rows: ComplaintImportRow[];
}

export function listComplaints(f: ComplaintFilters): Promise<AxiosResponse<ComplaintListOut>> {
  return api.get('/postal/complaints', { params: f });
}

export function previewComplaintImport(file: File): Promise<AxiosResponse<ComplaintImportPreview>> {
  const fd = new FormData();
  fd.append('file', file);
  return api.post('/postal/complaints/import/preview', fd);
}

export function commitComplaintImport(sessionId: string): Promise<AxiosResponse<PostalCommitOut>> {
  return api.post('/postal/complaints/import/commit', { session_id: sessionId });
}

// --- 改地址工单 (P3) -------------------------------------------------------

export interface PostalAddressChange {
  id: number;
  order_id: number | null;
  external_order_no: string | null;
  change_date: string | null;
  old_name: string | null;
  old_phone: string | null;
  old_address: string | null;
  old_copies: number | null;
  new_name: string | null;
  new_phone: string | null;
  new_address: string | null;
  new_copies: number | null;
  original_start_month: string | null;
  effective_start_month: string | null;
  handling: string | null;
  routed_label: string | null;
  applied_to_order: boolean;
  applied_at: string | null;
  notes: string | null;
}

export interface AddressChangeListOut { rows: PostalAddressChange[]; total: number }

export interface AddrImportRow {
  external_order_no: string;
  old_name: string;
  change_date: string | null;
  new_address: string;
  decision: 'import' | 'duplicate';
  linked: boolean;
  routed_label: string | null;
}

export interface SimpleImportPreview<T> {
  session_id: string;
  counts: Record<string, number>;
  can_commit: boolean;
  rows: T[];
}

export function listAddressChanges(f: { year?: number; applied?: boolean; search?: string; page?: number; page_size?: number }): Promise<AxiosResponse<AddressChangeListOut>> {
  return api.get('/postal/address-changes', { params: f });
}
export function previewAddressChangeImport(file: File): Promise<AxiosResponse<SimpleImportPreview<AddrImportRow>>> {
  const fd = new FormData(); fd.append('file', file);
  return api.post('/postal/address-changes/import/preview', fd);
}
export function commitAddressChangeImport(sessionId: string): Promise<AxiosResponse<PostalCommitOut>> {
  return api.post('/postal/address-changes/import/commit', { session_id: sessionId });
}
export function applyAddressChange(id: number): Promise<AxiosResponse<PostalAddressChange>> {
  return api.post(`/postal/address-changes/${id}/apply`);
}

// --- 回访 (P3) -------------------------------------------------------------

export interface PostalFollowUp {
  id: number;
  order_id: number | null;
  external_order_no: string | null;
  follow_up_date: string | null;
  batch_label: string | null;
  result: string | null;
  snap_name: string | null;
}

export interface FollowUpListOut { rows: PostalFollowUp[]; total: number }

export interface FollowImportRow {
  external_order_no: string;
  name: string;
  batch_label: string;
  follow_up_date: string | null;
  result: string;
  decision: 'import' | 'duplicate';
  linked: boolean;
}

export function listFollowUps(f: { year?: number; search?: string; page?: number; page_size?: number }): Promise<AxiosResponse<FollowUpListOut>> {
  return api.get('/postal/follow-ups', { params: f });
}
export function previewFollowUpImport(file: File): Promise<AxiosResponse<SimpleImportPreview<FollowImportRow>>> {
  const fd = new FormData(); fd.append('file', file);
  return api.post('/postal/follow-ups/import/preview', fd);
}
export function commitFollowUpImport(sessionId: string): Promise<AxiosResponse<PostalCommitOut>> {
  return api.post('/postal/follow-ups/import/commit', { session_id: sessionId });
}
