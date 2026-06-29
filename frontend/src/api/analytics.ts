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

export interface BsCirculationRow {
  issue_label: string;
  year: number | null;
  title: string | null;
  single_issue_qty: number;
  subscription_qty: number;
  total_qty: number;
  in_calendar: boolean;
}

export interface BsCirculationOut {
  rows: BsCirculationRow[];
  grand_total_single: number;
  grand_total_subscription: number;
  grand_total: number;
  unexpanded_subscriptions: number;
  year: number | null;
}

export interface OutstandingSummary {
  total_receivable: string;
  total_paid: string;
  total_outstanding: string;
  unpaid_orders: number;
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

export function getBsCirculation(
  params?: { year?: number },
): Promise<AxiosResponse<BsCirculationOut>> {
  return api.get('/analytics/bs-circulation', { params });
}

export function getOutstandingSummary(): Promise<AxiosResponse<OutstandingSummary>> {
  return api.get('/analytics/outstanding');
}
