import type { AxiosResponse } from 'axios';
import api from './client';

export interface Template {
  id: number;
  category: string;
  sub_category: string;
  display_name: string;
  default_value: number;
  is_variable: boolean;
  sort_order: number;
  excel_sheet: string | null;
  excel_cell: string | null;
}

export type TemplateCreate = Omit<Template, 'id' | 'excel_sheet' | 'excel_cell'>;
export type TemplateUpdate = Partial<TemplateCreate>;

export const getTemplates = (): Promise<AxiosResponse<Template[]>> =>
  api.get<Template[]>('/templates');

export const createTemplate = (data: TemplateCreate): Promise<AxiosResponse<Template>> =>
  api.post<Template>('/templates', data);

export const updateTemplate = (id: number, data: TemplateUpdate): Promise<AxiosResponse<Template>> =>
  api.put<Template>(`/templates/${id}`, data);

export const deleteTemplate = (id: number): Promise<AxiosResponse<void>> =>
  api.delete(`/templates/${id}`);

export const reorderTemplates = (
  items: { id: number; sort_order: number }[],
): Promise<AxiosResponse<void>> =>
  api.post('/templates/reorder', { items });
