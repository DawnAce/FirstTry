import axios from 'axios';
import type { DemandLine, ReviewStatus } from '../api/channelDemands';
import type { ScheduleEntry } from '../api/schedule';

export const demandStatusLabel = { draft: '草稿', confirmed: '已确认需求', superseded: '已被更正' };
export const kindLabel = { order: '订货单', report: '渠道报数单' };
export const reviewOptions: { value: ReviewStatus; label: string }[] = [
  { value: 'pending', label: '待确认' }, { value: 'confirmed', label: '已核对' }, { value: 'none', label: '明确不订' },
];
export const cycleOptions = [
  { value: 'month', label: '月度' }, { value: 'week', label: '周度' }, { value: 'biweek', label: '每两周' },
  { value: 'custom', label: '不定期' }, { value: 'fixed', label: '固定订阅' },
];
export const lineKey = (line: DemandLine) => `${line.issue_number}/${line.sub_category}`;
export function expandDemandLines(schedule: ScheduleEntry[], subs: string[], existing: DemandLine[] = []): DemandLine[] {
  const saved = new Map(existing.map(line => [lineKey(line), line]));
  return schedule.filter(s => !s.is_suspended && s.issue_number !== null).flatMap(s => subs.map(sub =>
    saved.get(`${s.issue_number}/${sub}`) ?? { issue_number: s.issue_number!, sub_category: sub, publish_date: s.publish_date, quantity: null, review_status: 'pending' },
  ));
}
export function demandSummary(lines: DemandLine[]) {
  return {
    quantity: lines.filter(l => l.review_status === 'confirmed').reduce((n, l) => n + (l.quantity ?? 0), 0),
    pending: lines.filter(l => l.review_status === 'pending').length,
    none: lines.filter(l => l.review_status === 'none').length,
  };
}
export function demandError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail: unknown = error.response?.data?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) return detail.map(d => d.msg ?? d.message ?? '输入内容不符合要求').join('；');
  }
  return '操作未完成，请刷新核对当前状态后重试';
}
