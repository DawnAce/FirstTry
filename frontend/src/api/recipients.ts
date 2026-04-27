import type { AxiosResponse } from 'axios';
import api from './client';

export interface Recipient {
  id: number;
  name: string;
  phone: string | null;
  province: string | null;
  city: string | null;
  address: string | null;
  type: 'corporate' | 'reader' | 'sample';
  frequency: 'weekly' | 'biweekly' | 'monthly';
  status: 'active' | 'suspended';
  notes: string | null;
  active_subscription_end: string | null;
  created_at: string;
}

export interface Subscription {
  id: number;
  recipient_id: number;
  type: 'new' | 'renewal';
  start_date: string;
  end_date: string;
  duration_months: number | null;
  quantity: number;
  notes: string | null;
  created_at: string;
}

export const getRecipients = (params?: Record<string, any>): Promise<AxiosResponse<Recipient[]>> =>
  api.get<Recipient[]>('/recipients', { params });

export const createRecipient = (data: Partial<Recipient>): Promise<AxiosResponse<Recipient>> =>
  api.post<Recipient>('/recipients', data);

export const updateRecipient = (id: number, data: Partial<Recipient>): Promise<AxiosResponse<Recipient>> =>
  api.put<Recipient>(`/recipients/${id}`, data);

export const updateRecipientStatus = (id: number, status: string): Promise<AxiosResponse<Recipient>> =>
  api.patch<Recipient>(`/recipients/${id}/status`, { status });

export const getSubscriptions = (recipientId: number): Promise<AxiosResponse<Subscription[]>> =>
  api.get<Subscription[]>(`/recipients/${recipientId}/subscriptions`);

export const createSubscription = (recipientId: number, data: Partial<Subscription>): Promise<AxiosResponse<Subscription>> =>
  api.post<Subscription>(`/recipients/${recipientId}/subscriptions`, data);
