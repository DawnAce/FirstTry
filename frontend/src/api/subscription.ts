import type { AxiosResponse } from 'axios';
import api from './client';

// 邮局订报数据生成模块 —— 上传驱动、版本流水、多文件生成。

export type BatchStatus = 'draft' | 'pending_validation' | 'ready' | 'generated' | 'archived';
export type ImportStatus =
  | 'uploading' | 'parsing' | 'validation_failed' | 'validation_passed' | 'active' | 'superseded';
export type IssueLevel = 'block' | 'warn' | 'info';
export type RunStatus = 'queued' | 'running' | 'success' | 'failed' | 'void';
export type ArtifactType = 'workbook' | 'postal_summary' | 'region_detail' | 'zip';

export interface SubBatch {
  id: number;
  year: number;
  start_month: number;
  make_date: string | null;
  unit_price: string | null;
  status: BatchStatus;
  active_version_id: number | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface SourceFile {
  id: number;
  file_role: string;
  file_type: string | null;
  original_filename: string;
  size: number | null;
  sha256: string | null;
}

export interface ImportVersion {
  id: number;
  batch_id: number;
  version_no: number;
  status: ImportStatus;
  reason: string | null;
  summary_json: Record<string, unknown> | null;
  uploaded_at: string | null;
  source_files: SourceFile[];
}

export interface BatchDetail extends SubBatch {
  versions: ImportVersion[];
}

export interface ValidationIssue {
  id: number;
  level: IssueLevel;
  source: string | null;
  sheet_or_file: string | null;
  row_no: number | null;
  field: string | null;
  code: string | null;
  message: string;
}

export interface SubRecord {
  id: number;
  name: string;
  phone: string | null;
  province: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  postal_code: string | null;
  copies: number;
  months: number | null;
  amount: string | null;
  region_name: string | null;
  source_channel: string | null;
  remittance_name: string | null;
  remittance_date: string | null;
  source_file_role: string | null;
  source_row: number | null;
  excluded: boolean;
  exclude_reason: string | null;
}

export interface ImportStatusOut {
  version: ImportVersion;
  issue_counts: Record<IssueLevel, number>;
  can_activate: boolean;
}

export interface Artifact {
  id: number;
  artifact_type: ArtifactType;
  region_name: string | null;
  filename: string;
  sha256: string | null;
  is_historical: boolean;
  created_at: string | null;
}

export interface GenerationRun {
  id: number;
  batch_id: number;
  version_id: number;
  rule_version: string | null;
  template_version: string | null;
  status: RunStatus;
  started_at: string | null;
  ended_at: string | null;
  error: string | null;
  artifacts: Artifact[];
}

export interface BatchCreatePayload {
  year: number;
  start_month: number;
  make_date?: string | null;
  unit_price?: number | null;
  notes?: string | null;
}

export function listSubBatches(): Promise<AxiosResponse<SubBatch[]>> {
  return api.get('/subscription/batches');
}

export function getSubBatch(id: number): Promise<AxiosResponse<BatchDetail>> {
  return api.get(`/subscription/batches/${id}`);
}

export function createSubBatch(body: BatchCreatePayload): Promise<AxiosResponse<SubBatch>> {
  return api.post('/subscription/batches', body);
}

export function createSubImport(
  batchId: number, fileA: File, fileB: File | null, reason?: string,
): Promise<AxiosResponse<ImportVersion>> {
  const fd = new FormData();
  fd.append('file_a', fileA);
  if (fileB) fd.append('file_b', fileB);
  if (reason) fd.append('reason', reason);
  return api.post(`/subscription/batches/${batchId}/imports`, fd);
}

export function getSubImport(versionId: number): Promise<AxiosResponse<ImportStatusOut>> {
  return api.get(`/subscription/imports/${versionId}`);
}

export function getSubImportIssues(versionId: number): Promise<AxiosResponse<ValidationIssue[]>> {
  return api.get(`/subscription/imports/${versionId}/issues`);
}

export function getSubImportRecords(versionId: number): Promise<AxiosResponse<SubRecord[]>> {
  return api.get(`/subscription/imports/${versionId}/records`);
}

export function activateSubImport(versionId: number): Promise<AxiosResponse<ImportVersion>> {
  return api.post(`/subscription/imports/${versionId}/activate`);
}

export function generateSubBatch(batchId: number): Promise<AxiosResponse<GenerationRun>> {
  return api.post(`/subscription/batches/${batchId}/generate`);
}

export function listSubArtifacts(batchId: number): Promise<AxiosResponse<Artifact[]>> {
  return api.get(`/subscription/batches/${batchId}/artifacts`);
}

export async function downloadSubArtifact(id: number, filename: string): Promise<void> {
  const res = await api.get(`/subscription/artifacts/${id}/download`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
