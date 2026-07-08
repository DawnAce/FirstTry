import type { AxiosResponse } from 'axios';
import api from './client';

export interface OperationLog {
  id: number;
  table_name: string;
  record_id: number;
  record_name: string | null;
  action: string;
  action_label: string; // 中文操作内容（后端从 action 派生）
  changes: Record<string, any> | null;
  user_id: number | null;
  username: string | null;
  issue_number: number | null; // 期数
  channel: string | null; // 渠道
  status: string; // success | failed
  created_at: string;
}

// 单条记录时间线（详情页操作日志抽屉用），table_name 必填。
export const getOperationLogs = (params: {
  table_name: string;
  record_id?: number;
}): Promise<AxiosResponse<OperationLog[]>> =>
  api.get<OperationLog[]>('/operation-logs', { params });

// 跨表最近操作记录（工作台「最近操作记录」用），table_name 可选。
export const getRecentOperationLogs = (params?: {
  issue_number?: number;
  action?: string;
  table_name?: string;
  limit?: number;
  skip?: number;
}): Promise<AxiosResponse<OperationLog[]>> =>
  api.get<OperationLog[]>('/operation-logs/recent', { params });
