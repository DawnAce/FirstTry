import api from './client';

export interface Issue {
  id: number;
  issue_number: number;
  publish_date: string;
  status: 'draft' | 'confirmed' | 'exported';
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface NextIssueInfo {
  issue_number: number;
  publish_date: string;
  previous_issue_id: number | null;
}

export const getIssues = (skip = 0, limit = 20) =>
  api.get<Issue[]>('/issues', { params: { skip, limit } });

export const getNextIssue = () =>
  api.get<NextIssueInfo>('/issues/next');

export const getAvailableIssues = () =>
  api.get<NextIssueInfo[]>('/issues/available');

export const createIssue = (data: { issue_number: number; publish_date: string }) =>
  api.post<Issue>('/issues', data);

export const getIssue = (id: number) =>
  api.get<Issue>(`/issues/${id}`);
