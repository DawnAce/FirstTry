import api from './client';

export interface ShippingRecord {
  id: number;
  issue_id: number;
  recipient_id: number;
  recipient_name: string;
  recipient_address: string | null;
  recipient_phone: string | null;
  recipient_type: string;
  quantity: number;
  status: string;
}

export const getShipping = (issueId: number) =>
  api.get<ShippingRecord[]>(`/issues/${issueId}/shipping`);

export const regenerateShipping = (issueId: number) =>
  api.post<ShippingRecord[]>(`/issues/${issueId}/shipping/regenerate`);
