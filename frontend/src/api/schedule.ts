import api from './client';

export interface ScheduleEntry {
  id: number;
  year: number;
  issue_number: number | null;
  publish_date: string;
  is_suspended: boolean;
}

export interface ScheduleSummary {
  total_rows: number;
  published_count: number;
  suspended_count: number;
  first_issue_number: number | null;
  last_issue_number: number | null;
  page_count?: number | null;
  remarks?: string | null;
}

export interface ScheduleDraftRow {
  publish_date: string;
  issue_number: number | null;
  is_suspended: boolean;
  page_count?: number | null;
}

export interface SchedulePreview {
  upload_id: number;
  year: number;
  rows: ScheduleDraftRow[];
  summary: ScheduleSummary;
  errors: string[];
  can_commit: boolean;
}

export interface ScheduleUpload {
  id: number;
  year: number;
  original_filename: string;
  status: 'previewed' | 'committed' | 'failed';
  summary_json: ScheduleSummary | null;
  error_json: string[] | null;
  uploaded_by: string | null;
  created_at: string | null;
  committed_at: string | null;
}

export const getSchedule = (year: number) =>
  api.get<ScheduleEntry[]>('/schedule', { params: { year } });

export const getScheduleUploads = (year?: number) =>
  api.get<ScheduleUpload[]>('/schedule/uploads', { params: year ? { year } : undefined });

export const previewScheduleUpload = (file: File) => {
  const form = new FormData();
  form.append('file', file);
  return api.post<SchedulePreview>('/schedule/uploads/preview', form);
};

export const updateScheduleUploadRows = (uploadId: number, rows: ScheduleDraftRow[]) =>
  api.put<SchedulePreview>(`/schedule/uploads/${uploadId}/rows`, { rows });

export const commitScheduleUpload = (uploadId: number, pageCount?: number | null) =>
  api.post<ScheduleUpload>(`/schedule/uploads/${uploadId}/commit`, null, {
    params: pageCount != null ? { page_count: pageCount } : undefined,
  });
