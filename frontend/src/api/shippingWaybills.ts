import type { AxiosResponse } from 'axios';
import api from './client';
import type { ShippingPackage } from './shippingDetails';

export interface WaybillImportRow {
  id: number;
  source_sheet: string;
  source_row: number;
  carrier: string;
  tracking_no: string | null;
  recipient_name: string;
  phone: string | null;
  address: string | null;
  quantity: number;
  no_tracking_required: boolean;
  raw_values: unknown[] | null;
  manual_reviewed: boolean;
  match_status: 'matched' | 'unmatched' | 'ambiguous' | 'duplicate' | 'invalid' | 'ignored';
  match_reason: string | null;
  shipping_detail_id: number | null;
}

export interface WaybillImportBatch {
  id: number;
  issue_id: number;
  issue_number: number;
  filename: string;
  status: 'previewed' | 'confirmed';
  expected_quantity: number;
  parsed_quantity: number;
  matched_quantity: number;
  pending_quantity: number;
  extra_quantity: number;
  matched_rows: number;
  unmatched_rows: number;
  warning_count: number;
  unresolved_quantity: number;
  file_gap_quantity: number;
  created_at: string;
  confirmed_at: string | null;
  rows: WaybillImportRow[];
}

export interface FulfillmentSummary {
  issue_id: number;
  issue_number: number;
  expected_quantity: number;
  planned_quantity: number;
  handled_quantity: number;
  tracked_quantity: number;
  no_tracking_quantity: number;
  actual_shipped_quantity: number;
  adjustment_quantity: number;
  deferred_quantity: number;
  unexplained_pending_quantity: number;
  attributed_adjustment_quantity: number;
  unattributed_adjustment_quantity: number;
  pending_quantity: number;
  extra_quantity: number;
  package_count: number;
  pending_detail_count: number;
  status: 'pending' | 'partial' | 'shipped' | 'exception';
  shipment_status: 'pending' | 'partial' | 'shipped' | 'exception';
  latest_import: WaybillImportBatch | null;
  adjustments: FulfillmentAdjustment[];
  deferrals: ShippingDeferral[];
  gap_details: ShippingGapDetail[];
}

export interface ShippingGapDetail {
  shipping_detail_id: number;
  name: string;
  phone: string | null;
  address: string | null;
  channel: string;
  sheet_name: string;
  frequency: string;
  planned_quantity: number;
  source_quantity: number;
  deferred_quantity: number;
  remaining_quantity: number;
  suggested_month_end: boolean;
}

export interface ShippingDeferral {
  id: number;
  issue_id: number;
  issue_number: number;
  shipping_detail_id: number | null;
  deferral_type: 'month_end_consolidation';
  quantity: number;
  reason: string;
  status: 'pending' | 'fulfilled' | 'cancelled';
  fulfilled_package_id: number | null;
  detail_name_snapshot: string | null;
  detail_phone_snapshot: string | null;
  detail_address_snapshot: string | null;
  detail_channel_snapshot: string | null;
  created_by: number | null;
  created_at: string;
  fulfilled_at: string | null;
}

export interface FulfillmentAdjustment {
  id: number;
  issue_id: number;
  issue_number: number;
  shipping_detail_id: number | null;
  adjustment_type: 'no_shipment_required';
  quantity: number;
  reason: string;
  detail_name_snapshot: string | null;
  detail_phone_snapshot: string | null;
  detail_address_snapshot: string | null;
  detail_channel_snapshot: string | null;
  detail_company_snapshot: string | null;
  detail_quantity_snapshot: number | null;
  is_attributed: boolean;
  created_by: number | null;
  created_at: string;
}

export interface WaybillImportRowInput {
  carrier?: string | null;
  tracking_no?: string | null;
  recipient_name?: string | null;
  phone?: string | null;
  address?: string | null;
  quantity?: number | null;
  no_tracking_required?: boolean;
  shipping_detail_id?: number | null;
  ignored?: boolean;
  ignore_reason?: string | null;
}

export const previewWaybillImport = (
  issueId: number,
  file: File,
  reparse = false,
): Promise<AxiosResponse<WaybillImportBatch>> => {
  const data = new FormData();
  data.append('file', file);
  data.append('reparse', String(reparse));
  return api.post<WaybillImportBatch>(`/shipping-waybills/issues/${issueId}/preview`, data);
};

export const getWaybillImportDraft = (issueId: number): Promise<AxiosResponse<WaybillImportBatch | null>> =>
  api.get<WaybillImportBatch | null>(`/shipping-waybills/issues/${issueId}/draft`);

export const getWaybillImport = (batchId: number): Promise<AxiosResponse<WaybillImportBatch>> =>
  api.get<WaybillImportBatch>(`/shipping-waybills/imports/${batchId}`);

export const updateWaybillImportRow = (
  batchId: number,
  rowId: number,
  data: WaybillImportRowInput,
): Promise<AxiosResponse<WaybillImportBatch>> =>
  api.patch<WaybillImportBatch>(`/shipping-waybills/imports/${batchId}/rows/${rowId}`, data);

export const addWaybillImportRow = (
  batchId: number,
  data: WaybillImportRowInput,
): Promise<AxiosResponse<WaybillImportBatch>> =>
  api.post<WaybillImportBatch>(`/shipping-waybills/imports/${batchId}/rows`, data);

export const bulkMatchWaybillImportRows = (
  batchId: number,
  rowIds: number[],
  shippingDetailId: number,
): Promise<AxiosResponse<WaybillImportBatch>> =>
  api.post<WaybillImportBatch>(`/shipping-waybills/imports/${batchId}/rows/bulk-match`, {
    row_ids: rowIds,
    shipping_detail_id: shippingDetailId,
  });

export const confirmWaybillImport = (batchId: number): Promise<AxiosResponse<WaybillImportBatch>> =>
  api.post<WaybillImportBatch>(`/shipping-waybills/imports/${batchId}/confirm`);

export const getFulfillmentSummary = (issueId: number): Promise<AxiosResponse<FulfillmentSummary>> =>
  api.get<FulfillmentSummary>(`/shipping-waybills/issues/${issueId}/summary`);

export const addFulfillmentAdjustment = (
  issueId: number,
  quantity: number,
  reason: string,
  shippingDetailId: number,
): Promise<AxiosResponse<FulfillmentSummary>> =>
  api.post<FulfillmentSummary>(`/shipping-waybills/issues/${issueId}/adjustments`, {
    adjustment_type: 'no_shipment_required',
    quantity,
    reason,
    shipping_detail_id: shippingDetailId,
  });

export const attributeFulfillmentAdjustment = (
  adjustmentId: number,
  shippingDetailId: number,
): Promise<AxiosResponse<FulfillmentSummary>> =>
  api.patch<FulfillmentSummary>(`/shipping-waybills/adjustments/${adjustmentId}/attribution`, {
    shipping_detail_id: shippingDetailId,
  });

export const deleteFulfillmentAdjustment = (
  adjustmentId: number,
): Promise<AxiosResponse<FulfillmentSummary>> =>
  api.delete<FulfillmentSummary>(`/shipping-waybills/adjustments/${adjustmentId}`);

export const addManualPackage = (
  detailId: number,
  data: { carrier: string; tracking_no: string; quantity: number; shipped_at?: string },
): Promise<AxiosResponse<ShippingPackage>> =>
  api.post<ShippingPackage>(`/shipping-waybills/details/${detailId}/packages`, data);

export const deleteShippingPackage = (packageId: number): Promise<AxiosResponse<void>> =>
  api.delete(`/shipping-waybills/packages/${packageId}`);

export const setNoTrackingRequired = (
  detailId: number,
  noTrackingRequired: boolean,
): Promise<AxiosResponse<FulfillmentSummary>> =>
  api.post<FulfillmentSummary>(`/shipping-waybills/details/${detailId}/no-tracking`, {
    no_tracking_required: noTrackingRequired,
  });

export const addShippingDeferrals = (
  issueId: number,
  items: Array<{ shipping_detail_id: number; quantity: number }>,
  reason: string,
): Promise<AxiosResponse<FulfillmentSummary>> =>
  api.post<FulfillmentSummary>(`/shipping-waybills/issues/${issueId}/deferrals`, {
    deferral_type: 'month_end_consolidation',
    reason,
    items,
  });

export const getPendingShippingDeferrals = (): Promise<AxiosResponse<ShippingDeferral[]>> =>
  api.get<ShippingDeferral[]>('/shipping-waybills/deferrals/pending');

export const deleteShippingDeferral = (deferralId: number): Promise<AxiosResponse<FulfillmentSummary>> =>
  api.delete<FulfillmentSummary>(`/shipping-waybills/deferrals/${deferralId}`);

export const addConsolidatedPackage = (
  carrier: string,
  trackingNo: string,
  deferralIds: number[],
): Promise<AxiosResponse<{
  package_id: number;
  carrier: string;
  tracking_no: string;
  quantity: number;
  fulfilled_deferral_ids: number[];
}>> => api.post('/shipping-waybills/packages/consolidated', {
  carrier,
  tracking_no: trackingNo,
  deferrals: deferralIds.map((deferral_id) => ({ deferral_id })),
});

export interface ShippingPlanTransferInput {
  source_detail_id: number;
  quantity: number;
  reason: string;
  target_detail_id?: number;
  target_name?: string;
  target_phone?: string;
  target_address?: string;
  target_channel?: string;
  target_sheet_name?: string;
  target_frequency?: string;
}

export const transferShippingPlanQuantity = (
  issueId: number,
  data: ShippingPlanTransferInput,
): Promise<AxiosResponse<{
  source_detail_id: number;
  source_quantity: number;
  target_detail_id: number;
  target_quantity: number;
  planned_quantity: number;
}>> => api.post(`/shipping-waybills/issues/${issueId}/plan-transfer`, data);
