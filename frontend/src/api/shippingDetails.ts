import type { AxiosResponse } from 'axios';
import api from './client';

export interface ShippingDetail {
  id: number;
  issue_number: number;
  sheet_name: string;
  channel: string;
  sub_channel: string | null;
  transport: string;
  frequency: string;
  status: string;
  name: string;
  address: string | null;
  phone: string | null;
  quantity: number;
  deadline: string | null;
  notes: string | null;
  extra_info: string | null;
  station_name: string | null;
  station_hall: string | null;
  contact_person: string | null;
  seq_number: number | null;
  period_count: number | null;
  confirmation: string | null;
  company: string | null;
  shipped_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShippingDetailCreate {
  issue_number: number;
  sheet_name: string;
  channel: string;
  sub_channel?: string;
  transport?: string;
  frequency?: string;
  status?: string;
  name: string;
  address?: string;
  phone?: string;
  quantity?: number;
  deadline?: string;
  notes?: string;
  extra_info?: string;
  station_name?: string;
  station_hall?: string;
  contact_person?: string;
  seq_number?: number;
  period_count?: number;
  confirmation?: string;
  company?: string;
  shipped_at?: string;
}

export interface ShippingDetailUpdate {
  channel?: string;
  sub_channel?: string;
  transport?: string;
  frequency?: string;
  status?: string;
  name?: string;
  address?: string;
  phone?: string;
  quantity?: number;
  deadline?: string;
  notes?: string;
  extra_info?: string;
  station_name?: string;
  station_hall?: string;
  contact_person?: string;
  seq_number?: number;
  period_count?: number;
  confirmation?: string;
  company?: string;
  shipped_at?: string;
}

export interface CopyShippingDetailsResult {
  message: string;
  copied: number;
}

export interface ShippingDetailBatchPatch {
  status?: string;
  deadline?: string;
}

export interface ShippingDetailBatchUpdate {
  ids: number[];
  updates: ShippingDetailBatchPatch;
}

export interface ShippingDetailBatchDelete {
  ids: number[];
}

export interface ShippingDetailBatchResult {
  affected_count: number;
}

export const getShippingDetails= (params?: Record<string, any>): Promise<AxiosResponse<ShippingDetail[]>> =>
  api.get<ShippingDetail[]>('/shipping-details', { params });

export const createShippingDetail = (data: ShippingDetailCreate): Promise<AxiosResponse<ShippingDetail>> =>
  api.post<ShippingDetail>('/shipping-details', data);

export const updateShippingDetail = (id: number, data: ShippingDetailUpdate): Promise<AxiosResponse<ShippingDetail>> =>
  api.put<ShippingDetail>(`/shipping-details/${id}`, data);

export const deleteShippingDetail = (id: number): Promise<AxiosResponse<void>> =>
  api.delete(`/shipping-details/${id}`);

export const batchUpdateShippingDetails = (
  data: ShippingDetailBatchUpdate,
): Promise<AxiosResponse<ShippingDetailBatchResult>> =>
  api.post<ShippingDetailBatchResult>('/shipping-details/batch-update', data);

export const batchDeleteShippingDetails = (
  data: ShippingDetailBatchDelete,
): Promise<AxiosResponse<ShippingDetailBatchResult>> =>
  api.post<ShippingDetailBatchResult>('/shipping-details/batch-delete', data);

export const clearShippingDetailsByIssue = (
  issueNumber: number,
): Promise<AxiosResponse<ShippingDetailBatchResult>> =>
  api.delete<ShippingDetailBatchResult>(`/shipping-details/by-issue/${issueNumber}`);

export const getShippingCompanies = (params?: Record<string, any>): Promise<AxiosResponse<string[]>> =>
  api.get<string[]>('/shipping-details/companies', { params });

export const copyShippingDetailsFromPrevious = (
  issueNumber: number,
  previousIssueNumber: number,
): Promise<AxiosResponse<CopyShippingDetailsResult>> =>
  api.post<CopyShippingDetailsResult>('/shipping-details/copy-from-previous', null, {
    params: { issue_number: issueNumber, previous_issue_number: previousIssueNumber },
  });
