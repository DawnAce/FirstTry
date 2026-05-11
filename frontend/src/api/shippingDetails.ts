import type { AxiosResponse } from 'axios';
import api from './client';

export interface ShippingDetail {
  id: number;
  issue_number: number;
  sheet_name: string;
  channel: string;
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
  city: string | null;
  station_name: string | null;
  station_hall: string | null;
  contact_person: string | null;
  seq_number: number | null;
  period_count: number | null;
  confirmation: string | null;
  company: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShippingDetailCreate {
  issue_number: number;
  sheet_name: string;
  channel: string;
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
  city?: string;
  station_name?: string;
  station_hall?: string;
  contact_person?: string;
  seq_number?: number;
  period_count?: number;
  confirmation?: string;
  company?: string;
}

export interface ShippingDetailUpdate {
  channel?: string;
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
  city?: string;
  station_name?: string;
  station_hall?: string;
  contact_person?: string;
  seq_number?: number;
  period_count?: number;
  confirmation?: string;
  company?: string;
}

export const getShippingDetails= (params?: Record<string, any>): Promise<AxiosResponse<ShippingDetail[]>> =>
  api.get<ShippingDetail[]>('/shipping-details', { params });

export const createShippingDetail = (data: ShippingDetailCreate): Promise<AxiosResponse<ShippingDetail>> =>
  api.post<ShippingDetail>('/shipping-details', data);

export const updateShippingDetail = (id: number, data: ShippingDetailUpdate): Promise<AxiosResponse<ShippingDetail>> =>
  api.put<ShippingDetail>(`/shipping-details/${id}`, data);

export const deleteShippingDetail = (id: number): Promise<AxiosResponse<void>> =>
  api.delete(`/shipping-details/${id}`);

export const getShippingCompanies = (params?: Record<string, any>): Promise<AxiosResponse<string[]>> =>
  api.get<string[]>('/shipping-details/companies', { params });
