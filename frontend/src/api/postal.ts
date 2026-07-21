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

// --- 投递名册（全部投递记录） ---------------------------------------------

export interface PostalDelivery {
  id: number;
  year: number;
  delivery_no: string;
  order_id: number | null;
  external_order_no: string | null;
  recipient_name: string;
  recipient_phone: string | null;
  recipient_province: string | null;
  recipient_city: string | null;
  recipient_district: string | null;
  recipient_address: string;
  recipient_postal_code: string | null;
  product: string | null;
  copies: number;
  amount: string | null;
  coverage_start_date: string | null;
  coverage_end_date: string | null;
  source_channel: string | null;
  distribution_unit_id: number | null;
  distribution_unit_name: string | null;
  salesperson: string | null;
  remittance_name: string | null;
  source_type: 'historical_import' | 'order_generated' | 'manual' | 'subscription_generated' | null;
}

export interface DeliveryListOut { rows: PostalDelivery[]; total: number; summary: { total_copies: number; unit_count: number; missing_unit_count: number } }

export interface DeliveryFilters {
  year?: number;
  channel?: string;
  distribution_unit_id?: number;
  month?: number;
  search?: string;
  page?: number;
  page_size?: number;
}

export function listDeliveries(f: DeliveryFilters): Promise<AxiosResponse<DeliveryListOut>> {
  return api.get('/postal/deliveries', { params: f });
}

export type PostalImportDecision = 'import' | 'duplicate' | 'unresolved';

export interface PostalImportRow {
  delivery_no: string;
  year: number | null;
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
  delivery_ids?: number[];
  order_ids?: number[];
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

export type PostalComplaintStatus = 'open' | 'in_progress' | 'resolved';

export interface PostalComplaint {
  id: number;
  postal_delivery_id: number | null;
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
  updated_at?: string | null;
}

export interface ComplaintListOut {
  rows: PostalComplaint[];
  total: number;
  summary: { open: number; in_progress: number; resolved: number };
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
  postal_delivery_id: number | null;
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

export interface AddressChangeListOut { rows: PostalAddressChange[]; total: number; summary: { pending_apply: number; unmatched: number; applied: number } }

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
  postal_delivery_id: number | null;
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

// --- 收款 / 发票 (P4) ------------------------------------------------------

export interface PostalFinance {
  id: number;
  order_id: number | null;
  external_order_no: string | null;
  link_by: string | null;
  payer_name: string | null;
  product: string | null;
  copies: number | null;
  amount: string | null;
  fee_amount: string | null;
  net_amount: string | null;
  collected_at: string | null;
  invoiced_amount: string | null;
  buyer_title: string | null;
  tax_no: string | null;
  invoice_recipient: string | null;
  tax_category: string | null;
  platform: string | null;
  notes: string | null;
}

export interface FinanceListOut { rows: PostalFinance[]; total: number; summary: { total_amount: number; total_net: number; unlinked_count: number } }

export interface FinanceImportRow {
  payer_name: string;
  product: string;
  amount: string | null;
  tax_category: string;
  platform: string;
  decision: 'import' | 'duplicate';
  linked: boolean;
  link_by: string;
}

export function listFinance(f: { platform?: string; tax_category?: string; linked?: boolean; search?: string; page?: number; page_size?: number }): Promise<AxiosResponse<FinanceListOut>> {
  return api.get('/postal/finance', { params: f });
}
export function previewFinanceImport(file: File): Promise<AxiosResponse<SimpleImportPreview<FinanceImportRow>>> {
  const fd = new FormData(); fd.append('file', file);
  return api.post('/postal/finance/import/preview', fd);
}
export function commitFinanceImport(sessionId: string): Promise<AxiosResponse<PostalCommitOut>> {
  return api.post('/postal/finance/import/commit', { session_id: sessionId });
}

// =====================================================================
// 手工 CRUD（新增 / 编辑 / 删除）+ 投诉三态处理流程
// =====================================================================

// --- 投递名册 ---
export interface DeliveryPayload {
  year: number;
  delivery_no: string;
  recipient_name: string;
  recipient_address: string;
  recipient_phone?: string | null;
  recipient_province?: string | null;
  recipient_city?: string | null;
  recipient_district?: string | null;
  recipient_postal_code?: string | null;
  external_order_no?: string | null;
  product?: string | null;
  copies?: number;
  amount?: number | null;
  coverage_start_date?: string | null;
  coverage_end_date?: string | null;
  source_channel?: string | null;
  distribution_unit_id?: number | null;
  salesperson?: string | null;
  remittance_name?: string | null;
}
export function createDelivery(body: DeliveryPayload): Promise<AxiosResponse<PostalDelivery>> {
  return api.post('/postal/deliveries', body);
}
export function updateDelivery(id: number, body: Partial<DeliveryPayload>): Promise<AxiosResponse<PostalDelivery>> {
  return api.put(`/postal/deliveries/${id}`, body);
}
export function deleteDelivery(id: number): Promise<AxiosResponse<void>> {
  return api.delete(`/postal/deliveries/${id}`);
}

// --- 投诉工单 + 处理流程 ---
export interface ComplaintPayload {
  year?: number | null;
  delivery_no?: string | null;
  complaint_date?: string | null;
  missing_issues?: string | null;
  handling?: string | null;
  routed_unit_id?: number | null;
  first_handler?: string | null;
  follow_up?: string | null;
  snap_name?: string | null;
  snap_phone?: string | null;
  snap_address?: string | null;
  status?: PostalComplaintStatus | null;
  notes?: string | null;
}
export interface PostalComplaintHandling {
  id: number;
  complaint_id: number;
  handled_at: string | null;
  handled_by: number | null;
  handled_by_name: string | null;
  action: string;
  follow_result: string | null;
  result_status: string | null;
}
export interface ComplaintDetail {
  complaint: PostalComplaint;
  handlings: PostalComplaintHandling[];
}
export interface HandlingPayload {
  action: string;
  follow_result?: string | null;
  result_status?: PostalComplaintStatus | null;
}
export function createComplaint(body: ComplaintPayload): Promise<AxiosResponse<PostalComplaint>> {
  return api.post('/postal/complaints', body);
}
export function updateComplaint(id: number, body: Partial<ComplaintPayload>): Promise<AxiosResponse<PostalComplaint>> {
  return api.put(`/postal/complaints/${id}`, body);
}
export function deleteComplaint(id: number): Promise<AxiosResponse<void>> {
  return api.delete(`/postal/complaints/${id}`);
}
export function getComplaintDetail(id: number): Promise<AxiosResponse<ComplaintDetail>> {
  return api.get(`/postal/complaints/${id}`);
}
export function addComplaintHandling(id: number, body: HandlingPayload): Promise<AxiosResponse<ComplaintDetail>> {
  return api.post(`/postal/complaints/${id}/handlings`, body);
}
export function deleteComplaintHandling(id: number, handlingId: number): Promise<AxiosResponse<ComplaintDetail>> {
  return api.delete(`/postal/complaints/${id}/handlings/${handlingId}`);
}

// --- 改地址 ---
export interface AddressChangePayload {
  year?: number | null;
  delivery_no?: string | null;
  change_date?: string | null;
  old_name?: string | null;
  old_phone?: string | null;
  old_address?: string | null;
  old_copies?: number | null;
  new_name?: string | null;
  new_phone?: string | null;
  new_address?: string | null;
  new_copies?: number | null;
  original_start_month?: string | null;
  effective_start_month?: string | null;
  handling?: string | null;
  notes?: string | null;
}
export function createAddressChange(body: AddressChangePayload): Promise<AxiosResponse<PostalAddressChange>> {
  return api.post('/postal/address-changes', body);
}
export function updateAddressChange(id: number, body: Partial<AddressChangePayload>): Promise<AxiosResponse<PostalAddressChange>> {
  return api.put(`/postal/address-changes/${id}`, body);
}
export function deleteAddressChange(id: number): Promise<AxiosResponse<void>> {
  return api.delete(`/postal/address-changes/${id}`);
}

// --- 回访 ---
export interface FollowUpPayload {
  year?: number | null;
  delivery_no?: string | null;
  follow_up_date?: string | null;
  batch_label?: string | null;
  result?: string | null;
  snap_name?: string | null;
}
export function createFollowUp(body: FollowUpPayload): Promise<AxiosResponse<PostalFollowUp>> {
  return api.post('/postal/follow-ups', body);
}
export function updateFollowUp(id: number, body: Partial<FollowUpPayload>): Promise<AxiosResponse<PostalFollowUp>> {
  return api.put(`/postal/follow-ups/${id}`, body);
}
export function deleteFollowUp(id: number): Promise<AxiosResponse<void>> {
  return api.delete(`/postal/follow-ups/${id}`);
}

// --- 收款 / 发票 ---
export interface FinancePayload {
  external_order_no?: string | null;
  payer_name?: string | null;
  product?: string | null;
  copies?: number | null;
  amount?: number | null;
  fee_amount?: number | null;
  net_amount?: number | null;
  collected_at?: string | null;
  invoiced_amount?: number | null;
  buyer_title?: string | null;
  tax_no?: string | null;
  invoice_recipient?: string | null;
  tax_category?: string | null;
  platform?: string | null;
  notes?: string | null;
}
export function createFinance(body: FinancePayload): Promise<AxiosResponse<PostalFinance>> {
  return api.post('/postal/finance', body);
}
export function updateFinance(id: number, body: Partial<FinancePayload>): Promise<AxiosResponse<PostalFinance>> {
  return api.put(`/postal/finance/${id}`, body);
}
export function deleteFinance(id: number): Promise<AxiosResponse<void>> {
  return api.delete(`/postal/finance/${id}`);
}
