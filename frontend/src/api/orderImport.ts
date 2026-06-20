import type { AxiosResponse } from 'axios';
import api from './client';

export type ImportDecision = 'import' | 'skip_status' | 'duplicate' | 'unresolved';

export interface ImportItemPreview {
  publication: string | null;
  fulfillment_type: string;
  subscription_term: string | null;
  delivery_method: string | null;
  total_quantity: number;
  unit_price: string;
  subtotal: string;
  coverage_start_date: string | null;
  coverage_end_date: string | null;
}

export interface ImportPreviewRow {
  external_order_no: string;
  recipient_name: string;
  paid_amount: string;
  status_raw: string;
  commercial_status: string | null;
  decision: ImportDecision;
  reason: string | null;
  status_unknown: boolean;
  delivery_overridden_to_zto: boolean;
  warnings: string[];
  items: ImportItemPreview[];
  unresolved_product: string | null;
}

export interface ImportPreviewOut {
  session_id: string;
  counts: Record<string, number>;
  can_commit: boolean;
  rows: ImportPreviewRow[];
}

export interface ImportCommitOut {
  created: number;
  order_ids: number[];
  skipped_duplicates: number;
}

export interface PreviewSettings {
  mode: 'recent' | 'historical';
  post_office_start_month?: string;
  zto_start_month?: string;
  cutoff_date?: string;
}

export function previewOrderImport(
  file: File,
  settings: PreviewSettings,
): Promise<AxiosResponse<ImportPreviewOut>> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('mode', settings.mode);
  if (settings.post_office_start_month) fd.append('post_office_start_month', settings.post_office_start_month);
  if (settings.zto_start_month) fd.append('zto_start_month', settings.zto_start_month);
  if (settings.cutoff_date) fd.append('cutoff_date', settings.cutoff_date);
  return api.post('/order-import/preview', fd);
}

export function commitOrderImport(sessionId: string): Promise<AxiosResponse<ImportCommitOut>> {
  return api.post('/order-import/commit', { session_id: sessionId });
}
