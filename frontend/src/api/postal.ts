import type { AxiosResponse } from 'axios';
import api from './client';

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
  return api.post('/postal/tickets/import/complaint/preview', fd);
}

export function commitComplaintImport(sessionId: string): Promise<AxiosResponse<PostalCommitOut>> {
  return api.post('/postal/tickets/import/complaint/commit', { session_id: sessionId });
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
  return api.post('/postal/tickets/import/address/preview', fd);
}
export function commitAddressChangeImport(sessionId: string): Promise<AxiosResponse<PostalCommitOut>> {
  return api.post('/postal/tickets/import/address/commit', { session_id: sessionId });
}
export function applyAddressChange(id: number): Promise<AxiosResponse<PostalAddressChange>> {
  return api.post(`/postal/tickets/${id}/apply`);
}
export function getAddressChange(id: number): Promise<AxiosResponse<PostalAddressChange>> {
  return api.get(`/postal/tickets/${id}`);
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
export function getFollowUp(id: number): Promise<AxiosResponse<PostalFollowUp>> {
  return api.get(`/postal/tickets/${id}`);
}
export function previewFollowUpImport(file: File): Promise<AxiosResponse<SimpleImportPreview<FollowImportRow>>> {
  const fd = new FormData(); fd.append('file', file);
  return api.post('/postal/tickets/import/follow/preview', fd);
}
export function commitFollowUpImport(sessionId: string): Promise<AxiosResponse<PostalCommitOut>> {
  return api.post('/postal/tickets/import/follow/commit', { session_id: sessionId });
}

// --- 客服工单（投诉 / 改地址 / 回访 统一列表） ------------------------------

export type TicketType = 'complaint' | 'address' | 'follow';

export interface Ticket {
  type: TicketType;
  id: number;
  year: number | null;
  delivery_no: string | null;
  recipient_name: string | null;
  postal_delivery_id: number | null;
  order_id: number | null;
  ticket_date: string | null;
  summary: string | null;
  status: string | null;            // 投诉三态；改地址 applied/pending/unmatched；回访 null
  handling_count: number | null;
  applied_to_order: boolean | null;
}

export interface TicketListOut {
  rows: Ticket[];
  total: number;
  summary: { complaint: number; address: number; follow: number };
}

export function listTickets(f: {
  type?: TicketType;
  year?: number;
  status?: string;
  applied?: boolean;
  search?: string;
  page?: number;
  page_size?: number;
}): Promise<AxiosResponse<TicketListOut>> {
  return api.get('/postal/tickets', { params: f });
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
  event_type: 'handling' | 'follow_up' | 'address_applied';
  source_ticket_id: number | null;
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
  return api.post('/postal/tickets', { type: 'complaint', ...body });
}
export function updateComplaint(id: number, body: Partial<ComplaintPayload>): Promise<AxiosResponse<PostalComplaint>> {
  return api.put(`/postal/tickets/${id}`, { type: 'complaint', ...body });
}
export function deleteComplaint(id: number): Promise<AxiosResponse<void>> {
  return api.delete(`/postal/tickets/${id}`);
}
export function getComplaintDetail(id: number): Promise<AxiosResponse<ComplaintDetail>> {
  return api.get(`/postal/tickets/${id}`);
}
export function addComplaintHandling(id: number, body: HandlingPayload): Promise<AxiosResponse<ComplaintDetail>> {
  return api.post(`/postal/tickets/${id}/handlings`, body);
}
export function deleteComplaintHandling(id: number, handlingId: number): Promise<AxiosResponse<ComplaintDetail>> {
  return api.delete(`/postal/tickets/${id}/handlings/${handlingId}`);
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
  return api.post('/postal/tickets', { type: 'address', ...body });
}
export function updateAddressChange(id: number, body: Partial<AddressChangePayload>): Promise<AxiosResponse<PostalAddressChange>> {
  return api.put(`/postal/tickets/${id}`, { type: 'address', ...body });
}
export function deleteAddressChange(id: number): Promise<AxiosResponse<void>> {
  return api.delete(`/postal/tickets/${id}`);
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
  return api.post('/postal/tickets', { type: 'follow', ...body });
}
export function updateFollowUp(id: number, body: Partial<FollowUpPayload>): Promise<AxiosResponse<PostalFollowUp>> {
  return api.put(`/postal/tickets/${id}`, { type: 'follow', ...body });
}
export function deleteFollowUp(id: number): Promise<AxiosResponse<void>> {
  return api.delete(`/postal/tickets/${id}`);
}
