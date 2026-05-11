import type { AxiosResponse } from 'axios';
import api from './client';

export interface OperationLog {
  id: number;
  table_name: string;
  record_id: number;
  record_name: string | null;
  action: 'create' | 'update' | 'delete';
  changes: Record<string, any> | null;
  user_id: number | null;
  username: string | null;
  created_at: string;
}

export const getOperationLogs = (params: {
  table_name: string;
  record_id?: number;
}): Promise<AxiosResponse<OperationLog[]>> =>
  api.get<OperationLog[]>('/operation-logs', { params });
