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
  match_status: 'matched' | 'unmatched' | 'ambiguous' | 'duplicate' | 'invalid';
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
  pending_quantity: number;
  extra_quantity: number;
  package_count: number;
  pending_detail_count: number;
  status: 'pending' | 'partial' | 'shipped' | 'exception';
  latest_import: WaybillImportBatch | null;
}

export const previewWaybillImport = (issueId: number, file: File): Promise<AxiosResponse<WaybillImportBatch>> => {
  const data = new FormData();
  data.append('file', file);
  return api.post<WaybillImportBatch>(`/shipping-waybills/issues/${issueId}/preview`, data);
};

export const confirmWaybillImport = (batchId: number): Promise<AxiosResponse<WaybillImportBatch>> =>
  api.post<WaybillImportBatch>(`/shipping-waybills/imports/${batchId}/confirm`);

export const getFulfillmentSummary = (issueId: number): Promise<AxiosResponse<FulfillmentSummary>> =>
  api.get<FulfillmentSummary>(`/shipping-waybills/issues/${issueId}/summary`);

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
