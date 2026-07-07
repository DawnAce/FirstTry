import api from './client';

// 镜像后端 app/schemas/analytics.py 的 OverviewOut。
export type PeriodStatus = '未创建' | '草稿' | '异常' | '待上传' | '已上传';

export interface PeriodRow {
  issue_number: number;
  issue_id: number | null;
  year: number;
  publish_date: string;
  status: PeriodStatus;
  report_zt_total: number; // 报数·中通合计
  shipping_total: number; // 发货明细·合计
  delta: number; // 报数 − 发货（正=少发）
  is_match: boolean;
  detail_count: number;
  has_shipping_drift: boolean;
  exception_note: string;
  last_updated_at: string | null;
}

export interface OverviewKpi {
  total: number;
  uploaded: number;
  pending: number; // 已开期、无发货明细
  uncreated: number; // 刊历有此期、系统未建
  exception: number;
  draft: number;
}

export interface OverviewReminder {
  no_shipping_count: number; // 尚未上传发货明细（待上传 + 未创建）
  delta_diff_count: number; // 报数与发货差异（异常且 delta≠0）
  draft_unconfirmed_count: number; // 草稿未确认
}

export interface LatestUpdate {
  issue_number: number;
  last_updated_at: string;
  status: PeriodStatus;
}

export interface OverviewExtras {
  recent_issues: PeriodRow[];
  upcoming_issues: PeriodRow[];
  reminders: OverviewReminder;
  latest_this_month: LatestUpdate | null;
}

export interface OverviewData {
  scope: string;
  year: number | null;
  rows: PeriodRow[];
  kpi: OverviewKpi;
  extras: OverviewExtras | null; // 仅 workbench 返回
}

// 工作台总览：本年概况 + KPI + 提醒 + 最近/后续期数（PR5 用）。
export const getWorkbenchOverview = (year?: number) =>
  api.get<OverviewData>('/analytics/overview', { params: { scope: 'workbench', year } });

// 期数总览：全部年份（year 可选过滤）。
export const getPeriodsOverview = (year?: number) =>
  api.get<OverviewData>('/analytics/overview', { params: { scope: 'periods', year } });
