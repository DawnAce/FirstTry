import type { AxiosResponse } from 'axios';
import api from './client';
import type { PostalCommitOut, SimpleImportPreview } from './postal';

// 财务管理：① 订单发票工作台(以订单为中心) + 发票登记/冲红；② 渠道结算(复用 partners)。
// 写操作后端要求管理员；结算附件经鉴权接口取 blob 下载。金额字段以字符串到达。

export type InvoiceType = 'normal' | 'red_reversal';
export type SettlementStatus = 'pending' | 'paid' | 'invoiced' | 'archived';
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
}

export interface Settlement {
  id: number;
  partner_id: number;
  partner_name: string;
  contract_id: number | null;
  period: string | null;
  amount_due: string | null;
  paid_amount: string | null;
  paid_date: string | null;
  on_time: boolean | null;
  invoice_received: boolean;
  invoice_no: string | null;
  status: SettlementStatus;
  attachment_filename: string | null;
  has_attachment: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SettlementPayload {
  partner_id: number;
  contract_id?: number | null;
  period?: string | null;
  amount_due?: string | number | null;
  paid_amount?: string | number | null;
  paid_date?: string | null;
  on_time?: boolean | null;
  invoice_received?: boolean;
  invoice_no?: string | null;
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
  list: (params?: { partner_id?: number; status?: SettlementStatus; q?: string }) =>
    ['settlements', params ?? {}] as const,
};

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

// --- 渠道结算 CRUD + 附件 ---
export function listSettlements(params?: {
  partner_id?: number;
  status?: SettlementStatus;
  q?: string;
}): Promise<AxiosResponse<Settlement[]>> {
  return api.get('/settlements', { params });
}
export function createSettlement(body: SettlementPayload): Promise<AxiosResponse<Settlement>> {
  return api.post('/settlements', body);
}
export function updateSettlement(id: number, body: SettlementUpdatePayload): Promise<AxiosResponse<Settlement>> {
  return api.put(`/settlements/${id}`, body);
}
export function deleteSettlement(id: number): Promise<AxiosResponse<void>> {
  return api.delete(`/settlements/${id}`);
}
export function uploadSettlementAttachment(id: number, file: File): Promise<AxiosResponse<Settlement>> {
  const fd = new FormData();
  fd.append('file', file);
  return api.post(`/settlements/${id}/attachment`, fd);
}
export function deleteSettlementAttachment(id: number): Promise<AxiosResponse<Settlement>> {
  return api.delete(`/settlements/${id}/attachment`);
}
export async function downloadSettlementAttachment(s: Settlement): Promise<void> {
  const res = await api.get(`/settlements/${s.id}/attachment`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = s.attachment_filename ?? `settlement-${s.id}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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

export function listFinance(f: { platform?: string; tax_category?: string; linked?: boolean; search?: string; page?: number; page_size?: number }): Promise<AxiosResponse<FinanceListOut>> {
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
