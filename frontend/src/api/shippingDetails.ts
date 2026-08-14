import type { AxiosResponse } from 'axios';
import api from './client';

export type ShippingDetailSourceType = 'manual' | 'order_generated' | 'historical_import' | 'complaint_makeup' | 'recurring_generated';

export type ShippingDetailSyncStatus = 'synced' | 'manually_modified' | 'orphaned';

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
  actual_name: string | null;
  actual_address: string | null;
  actual_phone: string | null;
  actual_adjustment_reason: string | null;
  actual_adjusted_at: string | null;
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
  shipped_quantity: number | null;
  tracking_no: string | null;
  shipping_requirement: string | null;
  physical_shipped_quantity: number;
  no_shipment_quantity: number;
  deferred_quantity: number;
  no_shipment_reason: string | null;
  handled_quantity: number;
  package_count: number;
  fulfillment_status: 'pending' | 'partial' | 'shipped' | 'no_tracking_required' | 'no_shipment_required';
  packages: ShippingPackage[];
  order_id: number | null;
  order_item_id: number | null;
  fulfillment_target_id: number | null;
  complaint_makeup_item_id?: number | null;
  complaint_makeup_task_id?: number | null;
  complaint_ticket_id?: number | null;
  postal_delivery_id?: number | null;
  source_type: ShippingDetailSourceType;
  sync_status: ShippingDetailSyncStatus;
  created_at: string;
  updated_at: string;
}

export interface ShippingPackage {
  id: number;
  carrier: string;
  tracking_no: string;
  quantity: number;
  shipped_at: string;
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
  sub_channel?: string | null;
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

export interface ActualShippingRecipientUpdate {
  name: string;
  address?: string;
  phone?: string;
  reason: string;
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

export interface ShippingPlanImportRow {
  sheet_name: string;
  channel: string;
  sub_channel: string;
  transport: string;
  frequency: string;
  status: string;
  name: string;
  address: string;
  phone: string;
  quantity: number;
  company: string;
}

export interface ShippingPlanImportAdjustment {
  sheet_name: string;
  name: string;
  quantity: number;
  field: string;
  original_value: string;
  resulting_value: string;
  original_notes: string;
  resulting_notes: string;
  operation: string;
}

export interface ShippingPlanImportPreview {
  issue_id: number;
  issue_number: number;
  filename: string;
  import_session_id: string;
  can_commit: boolean;
  errors: string[];
  warnings: string[];
  imported_row_count: number;
  imported_quantity: number;
  replaced_row_count: number;
  replaced_quantity: number;
  preserved_row_count: number;
  preserved_quantity: number;
  resulting_row_count: number;
  resulting_quantity: number;
  report_zto_total: number;
  confirmed_shipping_total: number | null;
  sample_rows: ShippingPlanImportRow[];
  adjustments: ShippingPlanImportAdjustment[];
}

export interface ShippingPlanImportCommitResult {
  issue_id: number;
  issue_number: number;
  deleted_count: number;
  created_count: number;
  preserved_count: number;
  resulting_quantity: number;
  restored_waybill_rows: number;
  restored_waybill_quantity: number;
  unresolved_waybill_rows: number;
  restored_adjustment_count: number;
  restored_deferral_count: number;
}

export const getShippingDetails= (params?: Record<string, any>): Promise<AxiosResponse<ShippingDetail[]>> =>
  api.get<ShippingDetail[]>('/shipping-details', { params });

export const createShippingDetail = (data: ShippingDetailCreate): Promise<AxiosResponse<ShippingDetail>> =>
  api.post<ShippingDetail>('/shipping-details', data);

export const updateShippingDetail = (id: number, data: ShippingDetailUpdate): Promise<AxiosResponse<ShippingDetail>> =>
  api.put<ShippingDetail>(`/shipping-details/${id}`, data);

export const updateActualShippingRecipient = (
  id: number,
  data: ActualShippingRecipientUpdate,
): Promise<AxiosResponse<ShippingDetail>> =>
  api.put<ShippingDetail>(`/shipping-details/${id}/actual-recipient`, data);

export const resetActualShippingRecipient = (id: number): Promise<AxiosResponse<ShippingDetail>> =>
  api.delete<ShippingDetail>(`/shipping-details/${id}/actual-recipient`);

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

export const previewShippingPlanImport = (
  issueId: number,
  file: File,
): Promise<AxiosResponse<ShippingPlanImportPreview>> => {
  const form = new FormData();
  form.append('shipping_file', file);
  return api.post<ShippingPlanImportPreview>(
    `/shipping-details/issues/${issueId}/import-preview`,
    form,
  );
};

export const commitShippingPlanImport = (
  issueId: number,
  importSessionId: string,
  reason: string,
  adjustmentsConfirmed: boolean,
): Promise<AxiosResponse<ShippingPlanImportCommitResult>> =>
  api.post<ShippingPlanImportCommitResult>(
    `/shipping-details/issues/${issueId}/import-commit`,
    {
      import_session_id: importSessionId,
      reason,
      adjustments_confirmed: adjustmentsConfirmed,
    },
  );

export interface ShipDetailPayload {
  shipped_at?: string | null;
  shipped_quantity?: number | null;
  tracking_no?: string | null;
}

export const shipShippingDetail = (
  id: number,
  data: ShipDetailPayload = {},
): Promise<AxiosResponse<ShippingDetail>> =>
  api.post<ShippingDetail>(`/shipping-details/${id}/ship`, data);

export const unshipShippingDetail = (
  id: number,
): Promise<AxiosResponse<ShippingDetail>> =>
  api.post<ShippingDetail>(`/shipping-details/${id}/unship`);
