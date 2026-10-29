import api from './client';

// 镜像后端 app/schemas/analytics.py 的 OverviewOut。
export type PeriodStatus = '未创建' | '草稿' | '异常' | '待上传' | '已上传';
export type PlanStatus = '未创建' | '草稿' | '待导入' | '有差异' | '有变更' | '已就绪';
export type WaybillStatus = '未开始' | '待上传' | '部分完成' | '已完成' | '需核对';

export interface PeriodRow {
  issue_number: number;
  issue_id: number | null;
  year: number;
  publish_date: string;
  status: PeriodStatus;
  plan_status: PlanStatus;
  waybill_status: WaybillStatus;
  report_zt_total: number; // 报数·中通合计
  shipping_total: number; // 发货计划·合计（旧字段名保留兼容）
  actual_shipped_total: number; // 实际寄出，含无需运单
  handled_total: number; // 已核销，含无需发货
  pending_quantity: number;
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
  rows: PeriodRow[]; // 正式刊历中非休刊、出版日期 <= 服务端今天的期次
  kpi: OverviewKpi;
  extras: OverviewExtras | null; // 仅 workbench 返回
}

// 工作台：本年已到出版日期的概况与待办；extras.upcoming_issues 保留后续预告。
export const getWorkbenchOverview = (year?: number) =>
  api.get<OverviewData>('/analytics/overview', { params: { scope: 'workbench', year } });

// 期数总览：跨年份的已到出版日期期次（year 可选过滤）。
export const getPeriodsOverview = (year?: number) =>
  api.get<OverviewData>('/analytics/overview', { params: { scope: 'periods', year } });
