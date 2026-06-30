import type { AxiosResponse } from 'axios';
import api from './client';

// 合同管理：合作渠道(partners) + 渠道合同(contracts) + 扫描件附件。
// 写操作后端要求管理员；下载经鉴权接口取 blob 再触发浏览器下载。

export type PartnerType = 'logistics' | 'distribution' | 'retail' | 'other';
export type ContractStatus = 'active' | 'expired' | 'archived' | 'void';

export interface Partner {
  id: number;
  name: string;
  partner_type: PartnerType;
  contact_person: string | null;
  contact_phone: string | null;
  settlement_account: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PartnerPayload {
  name: string;
  partner_type?: PartnerType;
  contact_person?: string | null;
  contact_phone?: string | null;
  settlement_account?: string | null;
  notes?: string | null;
  active?: boolean;
}
export type PartnerUpdatePayload = Partial<PartnerPayload>;

export interface Contract {
  id: number;
  partner_id: number;
  partner_name: string;
  // 正常恒有值；仅外键悬空（异常数据）时后端返回 null（优雅降级）。
  partner_type: PartnerType | null;
  contract_no: string | null;
  title: string;
  sign_year: number | null;
  sign_date: string | null;
  start_date: string | null;
  end_date: string | null;
  amount: string | null;
  status: ContractStatus;
  attachment_filename: string | null;
  has_attachment: boolean;
  is_expiring: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContractPayload {
  partner_id: number;
  title: string;
  contract_no?: string | null;
  sign_year?: number | null;
  sign_date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  amount?: string | number | null;
  status?: ContractStatus;
  notes?: string | null;
}
export type ContractUpdatePayload = Partial<ContractPayload>;

export interface ContractListParams {
  partner_id?: number;
  status?: ContractStatus;
  sign_year?: number;
  q?: string;
}

export const partnerQueryKeys = {
  all: ['partners'] as const,
  list: (params?: { active?: boolean; q?: string }) => ['partners', params ?? {}] as const,
};
export const contractQueryKeys = {
  all: ['contracts'] as const,
  list: (params?: ContractListParams) => ['contracts', params ?? {}] as const,
};

// --- partners ---
export function listPartners(params?: {
  active?: boolean;
  q?: string;
}): Promise<AxiosResponse<Partner[]>> {
  return api.get('/partners', { params });
}
export function createPartner(body: PartnerPayload): Promise<AxiosResponse<Partner>> {
  return api.post('/partners', body);
}
export function updatePartner(
  id: number,
  body: PartnerUpdatePayload,
): Promise<AxiosResponse<Partner>> {
  return api.put(`/partners/${id}`, body);
}
export function deletePartner(id: number): Promise<AxiosResponse<void>> {
  return api.delete(`/partners/${id}`);
}

// --- contracts ---
export function listContracts(
  params?: ContractListParams,
): Promise<AxiosResponse<Contract[]>> {
  return api.get('/contracts', { params });
}
export function createContract(body: ContractPayload): Promise<AxiosResponse<Contract>> {
  return api.post('/contracts', body);
}
export function updateContract(
  id: number,
  body: ContractUpdatePayload,
): Promise<AxiosResponse<Contract>> {
  return api.put(`/contracts/${id}`, body);
}
export function deleteContract(id: number): Promise<AxiosResponse<void>> {
  return api.delete(`/contracts/${id}`);
}

// --- attachment ---
export function uploadContractAttachment(
  id: number,
  file: File,
): Promise<AxiosResponse<Contract>> {
  const fd = new FormData();
  fd.append('file', file);
  return api.post(`/contracts/${id}/attachment`, fd);
}
export function deleteContractAttachment(id: number): Promise<AxiosResponse<Contract>> {
  return api.delete(`/contracts/${id}/attachment`);
}
export async function downloadContractAttachment(contract: Contract): Promise<void> {
  const res = await api.get(`/contracts/${contract.id}/attachment`, {
    responseType: 'blob',
  });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = contract.attachment_filename ?? `contract-${contract.id}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
