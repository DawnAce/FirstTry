import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import type { CoverageStartMode, SubscriptionTerm } from '../api/orders';

export function coverageEnd(term: SubscriptionTerm, start: Dayjs, mode: CoverageStartMode): Dayjs {
  const anchor = mode === 'month' ? start.startOf('month') : start;
  return anchor.add(term === 'half_year' ? 6 : 12, 'month').subtract(1, 'day');
}

export function existingCoverage(item: {
  coverage_start_mode?: CoverageStartMode | null;
  coverage_start_date: string | null;
  coverage_end_date: string | null;
  subscription_term: SubscriptionTerm | null;
}) {
  const start = item.coverage_start_date ? dayjs(item.coverage_start_date) : null;
  const end = item.coverage_end_date ? dayjs(item.coverage_end_date) : null;
  // 历史记录不能仅因打开编辑页就按月份重新舍入。
  const mode = item.coverage_start_mode ?? (start ? 'date' : 'month');
  const adjusted = !!(start && end && item.subscription_term && (
    item.subscription_term === 'custom' || !coverageEnd(item.subscription_term, start, mode).isSame(end, 'day')
  ));
  return { start, end, mode, adjusted };
}
