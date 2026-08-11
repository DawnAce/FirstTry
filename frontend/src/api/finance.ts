import type { AxiosResponse } from 'axios';
import api from './client';
import type { PostalCommitOut, SimpleImportPreview } from './postal';

// 财务管理：① 订单发票工作台(以订单为中心) + 发票登记/冲红；② 渠道结算(复用 partners)。
// 写操作后端要求管理员；结算附件经鉴权接口取 blob 下载。金额字段以字符串到达。

export type InvoiceType = 'normal' | 'red_reversal';
export type SettlementStatus = 'pending' | 'paid' | 'invoiced' | 'archived';
export type SettlementDirection = 'receivable' | 'payable';
export type SettlementPartyType = 'channel' | 'individual';
export type SettlementType = 'consignment' | 'buyout';
export type SettlementInvoiceStatus = 'unissued' | 'issued';
export type SettlementPaymentStatus = 'unpaid' | 'partial' | 'paid';
export type SettlementAttachmentCategory = 'settlement_sheet' | 'invoice_application' | 'invoice' | 'other';
export type InvoiceState = 'pending' | 'issued' | 'needs_red_reversal';

export interface Invoice {
  id: number;
  order_id: number;
  invoice_type: InvoiceType;
  invoice_no: string | null;
  amount: string | null;
  issued_date: string | null;
  buyer_title: string | null;
  tax_no: string | null;
  attachment_filename: string | null;
  has_attachment: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoicePayload {
  order_id: number;
  invoice_type?: InvoiceType;
  invoice_no?: string | null;
  amount?: string | number | null;
  issued_date?: string | null;
  buyer_title?: string | null;
  tax_no?: string | null;
  notes?: string | null;
}
export type InvoiceUpdatePayload = Partial<Omit<InvoicePayload, 'order_id'>>;

export interface InvoiceOrderRow {
  order_id: number;
  order_code: string | null;
  payer_name: string;
  order_date: string;
  total_amount: string;
  refunded_amount: string;
  invoice_required: boolean;
  invoice_title: string | null;
  invoice_tax_no: string | null;
  invoice_recipient_email: string | null;
  normal_invoiced_amount: string;
  remaining_invoice_amount: string;
  invoices: Invoice[];
  invoice_state: InvoiceState;
  needs_red_reversal: boolean;
  order_voided: boolean;
}

export interface InvoiceOrdersOut {
  rows: InvoiceOrderRow[];
  total: number;
  pending_count: number;
  needs_red_reversal_count: number;
  issued_count: number;
}

export interface Settlement {
  id: number;
  partner_id: number;
  partner_name: string;
  contract_id: number | null;
  direction: SettlementDirection;
  party_type: SettlementPartyType;
  settlement_type: SettlementType | null;
  system_no: string;
  external_no: string | null;
  settlement_no: string | null;
  period: string | null;
  settlement_start_date: string | null;
  settlement_end_date: string | null;
  return_start_date: string | null;
  return_end_date: string | null;
  gross_amount: string | null;
  return_deduction_amount: string;
  amount_due: string | null;
  paid_amount: string | null;
  paid_date: string | null;
  on_time: boolean | null;
  invoice_received: boolean;
  invoice_status: SettlementInvoiceStatus;
  payment_status: SettlementPaymentStatus;
  invoice_no: string | null;
  invoice_date: string | null;
  invoice_title: string | null;
  invoice_tax_no: string | null;
  invoice_taxpayer_type: string | null;
  invoice_type: string | null;
  invoice_item_name: string | null;
  invoice_unit: string | null;
  invoice_quantity: string | null;
  invoice_unit_price: string | null;
  invoice_tax_rate: string | null;
  invoice_amount: string | null;
  status: SettlementStatus;
  attachment_filename: string | null;
  has_attachment: boolean;
  attachments: SettlementAttachment[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SettlementAttachment {
  id: number;
  category: SettlementAttachmentCategory;
  filename: string;
  content_type: string | null;
  file_size: number | null;
  sha256: string | null;
  is_primary: boolean;
  recognized: boolean | null;
  recognition_parser_version: string | null;
  recognition_result: Record<string, unknown> | null;
  created_at: string;
}

export interface SettlementPayload {
  partner_id: number;
  contract_id?: number | null;
  direction?: SettlementDirection;
  party_type?: SettlementPartyType;
  settlement_type?: SettlementType | null;
  external_no?: string | null;
  settlement_no?: string | null;
  period?: string | null;
  settlement_start_date?: string | null;
  settlement_end_date?: string | null;
  return_start_date?: string | null;
  return_end_date?: string | null;
  gross_amount?: string | number | null;
  return_deduction_amount?: string | number;
  amount_due?: string | number | null;
  paid_amount?: string | number | null;
  paid_date?: string | null;
  on_time?: boolean | null;
  invoice_received?: boolean;
  invoice_no?: string | null;
  invoice_date?: string | null;
  invoice_title?: string | null;
  invoice_tax_no?: string | null;
  invoice_taxpayer_type?: string | null;
  invoice_type?: string | null;
  invoice_item_name?: string | null;
  invoice_unit?: string | null;
  invoice_quantity?: string | number | null;
  invoice_unit_price?: string | number | null;
  invoice_tax_rate?: string | number | null;
  invoice_amount?: string | number | null;
  status?: SettlementStatus;
  notes?: string | null;
}
export type SettlementUpdatePayload = Partial<SettlementPayload>;

export const invoiceQueryKeys = {
  all: ['invoices'] as const,
  orders: (params?: { status?: string; q?: string }) => ['invoices', 'orders', params ?? {}] as const,
};
export const settlementQueryKeys = {
  all: ['settlements'] as const,
  list: (params?: SettlementListParams) =>
    ['settlements', params ?? {}] as const,
};

export interface SettlementListParams {
  partner_id?: number;
  direction?: SettlementDirection;
  party_type?: SettlementPartyType;
  settlement_type?: SettlementType;
  invoice_status?: SettlementInvoiceStatus;
  payment_status?: SettlementPaymentStatus;
  status?: SettlementStatus;
  settlement_from?: string;
  settlement_to?: string;
  q?: string;
}

// --- 发票工作台 + 发票 CRUD ---
export function getInvoiceOrders(params?: {
  status?: string;
  q?: string;
}): Promise<AxiosResponse<InvoiceOrdersOut>> {
  return api.get('/invoices/orders', { params });
}
export function createInvoice(body: InvoicePayload): Promise<AxiosResponse<Invoice>> {
  return api.post('/invoices', body);
}
export function updateInvoice(id: number, body: InvoiceUpdatePayload): Promise<AxiosResponse<Invoice>> {
  return api.put(`/invoices/${id}`, body);
}
export function deleteInvoice(id: number): Promise<AxiosResponse<void>> {
  return api.delete(`/invoices/${id}`);
}
export function uploadInvoiceAttachment(id: number, file: File): Promise<AxiosResponse<Invoice>> {
  const fd = new FormData();
  fd.append('file', file);
  return api.post(`/invoices/${id}/attachment`, fd);
}
export function getInvoiceAttachment(id: number): Promise<AxiosResponse<Blob>> {
  return api.get(`/invoices/${id}/attachment`, { responseType: 'blob' });
}
export function deleteInvoiceAttachment(id: number): Promise<AxiosResponse<Invoice>> {
  return api.delete(`/invoices/${id}/attachment`);
}
export async function downloadInvoiceAttachment(invoice: Invoice): Promise<void> {
  const res = await getInvoiceAttachment(invoice.id);
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = invoice.attachment_filename ?? `invoice-${invoice.id}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// --- 渠道结算 CRUD + 附件 ---
export function listSettlements(params?: SettlementListParams): Promise<AxiosResponse<Settlement[]>> {
  return api.get('/settlements', { params });
}
export function createSettlement(body: SettlementPayload): Promise<AxiosResponse<Settlement>> {
  return api.post('/settlements', body);
}
export function createSettlementWithAttachments(
  body: SettlementPayload,
  attachments: Array<{ category: SettlementAttachmentCategory; file: File; isPrimary?: boolean }>,
): Promise<AxiosResponse<Settlement>> {
  const fd = new FormData();
  fd.append('payload_json', JSON.stringify(body));
  fd.append('categories_json', JSON.stringify(attachments.map((item) => item.category)));
  const primaryIndex = attachments.findIndex((item) => item.isPrimary);
  if (primaryIndex >= 0) fd.append('primary_attachment_index', String(primaryIndex));
  attachments.forEach((item) => fd.append('files', item.file));
  return api.post('/settlements/with-attachments', fd);
}

export interface SettlementExcelPreview {
  recognized: boolean;
  parser_version: string;
  filename: string;
  supplier_name: string | null;
  external_no: string | null;
  settlement_start_date: string | null;
  settlement_end_date: string | null;
  return_start_date: string | null;
  return_end_date: string | null;
  gross_amount: string | null;
  return_deduction_amount: string;
  amount_due: string | null;
  invoice_item_name: string | null;
  invoice_quantity: string | null;
  invoice_unit_price: string | null;
  invoice_amount: string | null;
  detail_count: number;
  return_detail_count: number;
  warnings: string[];
}
export function previewSettlementExcel(file: File): Promise<AxiosResponse<SettlementExcelPreview>> {
  const fd = new FormData();
  fd.append('file', file);
  return api.post('/settlements/import/preview', fd);
}
export function updateSettlement(id: number, body: SettlementUpdatePayload): Promise<AxiosResponse<Settlement>> {
  return api.put(`/settlements/${id}`, body);
}
export function deleteSettlement(id: number): Promise<AxiosResponse<void>> {
  return api.delete(`/settlements/${id}`);
}
export function uploadSettlementAttachment(
  id: number,
  category: SettlementAttachmentCategory,
  file: File,
  isPrimary = false,
): Promise<AxiosResponse<Settlement>> {
  const fd = new FormData();
  fd.append('file', file);
  return api.post(`/settlements/${id}/attachments`, fd, { params: { category, is_primary: isPrimary } });
}
export function updateSettlementAttachment(
  id: number,
  attachmentId: number,
  params: { category?: SettlementAttachmentCategory; is_primary?: boolean },
): Promise<AxiosResponse<Settlement>> {
  return api.put(`/settlements/${id}/attachments/${attachmentId}`, null, { params });
}
export function deleteSettlementAttachment(id: number, attachmentId: number): Promise<AxiosResponse<Settlement>> {
  return api.delete(`/settlements/${id}/attachments/${attachmentId}`);
}
export async function downloadSettlementAttachment(
  s: Settlement,
  attachment: SettlementAttachment,
): Promise<void> {
  const res = await api.get(`/settlements/${s.id}/attachments/${attachment.id}`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = attachment.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface SettlementInvoiceRegisterPayload {
  invoice_no?: string | null;
  invoice_date: string;
  invoice_title?: string | null;
  invoice_tax_no?: string | null;
  invoice_taxpayer_type?: string | null;
  invoice_type?: string | null;
  invoice_item_name?: string | null;
  invoice_unit?: string | null;
  invoice_quantity?: number | null;
  invoice_unit_price?: number | null;
  invoice_tax_rate?: number | null;
  invoice_amount?: number | null;
  notes?: string | null;
}
export interface SettlementPaymentRegisterPayload {
  amount: number;
  paid_date: string;
  on_time?: boolean | null;
  notes?: string | null;
}
export interface SettlementHistory {
  id: number;
  action: string;
  changes: Record<string, unknown> | null;
  username: string | null;
  created_at: string;
}
export function registerSettlementInvoice(id: number, body: SettlementInvoiceRegisterPayload): Promise<AxiosResponse<Settlement>> {
  return api.post(`/settlements/${id}/invoice`, body);
}
export function registerSettlementPayment(id: number, body: SettlementPaymentRegisterPayload): Promise<AxiosResponse<Settlement>> {
  return api.post(`/settlements/${id}/payment`, body);
}
export function getSettlementHistory(id: number): Promise<AxiosResponse<SettlementHistory[]>> {
  return api.get(`/settlements/${id}/history`);
}

// ===========================================================================
// 邮局收款 / 发票（原挂 /api/postal/finance，重构后迁入财务命名空间 /api/finance/postal-receipts）
// 数据模型仍是 PostalFinance，仅 API 归属改变。
// ===========================================================================

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

export interface FinanceListOut {
  rows: PostalFinance[];
  total: number;
  summary: { total_amount: number; total_net: number; unlinked_count: number };
}

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

export function listFinance(f: { platform?: string; tax_category?: string; linked?: boolean; search?: string; page?: number; page_size?: number; summary_only?: boolean }): Promise<AxiosResponse<FinanceListOut>> {
  return api.get('/finance/postal-receipts', { params: f });
}
export function previewFinanceImport(file: File): Promise<AxiosResponse<SimpleImportPreview<FinanceImportRow>>> {
  const fd = new FormData(); fd.append('file', file);
  return api.post('/finance/postal-receipts/import/preview', fd);
}
export function commitFinanceImport(sessionId: string): Promise<AxiosResponse<PostalCommitOut>> {
  return api.post('/finance/postal-receipts/import/commit', { session_id: sessionId });
}
export function createFinance(body: FinancePayload): Promise<AxiosResponse<PostalFinance>> {
  return api.post('/finance/postal-receipts', body);
}
export function updateFinance(id: number, body: Partial<FinancePayload>): Promise<AxiosResponse<PostalFinance>> {
  return api.put(`/finance/postal-receipts/${id}`, body);
}
export function deleteFinance(id: number): Promise<AxiosResponse<void>> {
  return api.delete(`/finance/postal-receipts/${id}`);
}
