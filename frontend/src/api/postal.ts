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
