import api from './client';

export interface Issue {
  id: number;
  issue_number: number;
  year_issue_index: number | null;
  year_issue_label: string | null;
  publish_date: string;
  page_count: number;
  planned_page_count: number | null;
  status: 'draft' | 'confirmed' | 'exported';
  notes: string | null;
  created_at: string;
  updated_at: string;
  print_total?: number;
}

export interface NextIssueInfo {
  issue_number: number;
  publish_date: string;
  page_count: number | null;
  previous_issue_id: number | null;
}

export interface WeeklyStats {
  this_week_total: number;
  last_week_total: number;
  week_change: number;
}

export interface DashboardData {
  recent_issues: Issue[];
  stats: { total: number; draft: number };
  weekly_stats: WeeklyStats;
  latest_report_time: string | null;
  next_issue_number: number | null;
  next_issue_publish_date: string | null;
  next_issue: NextIssueInfo | null;
  available_issues: NextIssueInfo[];
}

export const getDashboard = () =>
  api.get<DashboardData>('/dashboard');

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

export const updateIssue = (id: number, data: { page_count?: number; notes?: string }) =>
  api.patch<Issue>(`/issues/${id}`, data);

export const deleteIssue = (id: number) =>
  api.delete<{ message: string }>(`/issues/${id}`);
