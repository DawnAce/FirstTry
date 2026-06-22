import type { AxiosResponse } from 'axios';
import api from './client';

// Decimal fields arrive as strings (same convention as Product.list_price etc.).

export interface CampaignSummaryRow {
  campaign: string;
  order_count: number;
  total_paid: string;
  total_listed: string;
  total_discount: string;
}

export interface CampaignSummaryOut {
  rows: CampaignSummaryRow[];
  total_campaigns: number;
  grand_total_orders: number;
  grand_total_paid: string;
  grand_total_listed: string;
  grand_total_discount: string;
  date_from: string | null;
  date_to: string | null;
}

export interface IssueSummaryRow {
  publication: string;
  issue_label: string;
  line_count: number;
  total_quantity: number;
  total_paid: string;
}

export interface IssueSummaryOut {
  rows: IssueSummaryRow[];
  total_issues: number;
  grand_total_quantity: number;
  grand_total_paid: string;
  date_from: string | null;
  date_to: string | null;
}

export interface DateRangeParams {
  date_from?: string;
  date_to?: string;
}

export function getCampaignSummary(
  params?: DateRangeParams,
): Promise<AxiosResponse<CampaignSummaryOut>> {
  return api.get('/analytics/campaigns', { params });
}

export function getIssueSummary(
  params?: DateRangeParams & { publication?: string },
): Promise<AxiosResponse<IssueSummaryOut>> {
  return api.get('/analytics/issues', { params });
}
