import dayjs from 'dayjs';
import type { CoverageCandidate } from '../api/orderCoverage';

export interface CoverageDraft { start: string | null; end: string | null }

/** 合同订期按自然月；实际发行期数由刊期表另行计算。 */
export function monthCoverage(startMonth: string, months: number): CoverageDraft {
  const start = dayjs(`${startMonth}-01`);
  return { start: start.format('YYYY-MM-DD'), end: start.add(months, 'month').subtract(1, 'day').format('YYYY-MM-DD') };
}

export function fillCoverage(row: CoverageCandidate, proposed: CoverageDraft): CoverageDraft {
  return { start: row.coverage_start_date || proposed.start, end: row.coverage_end_date || proposed.end };
}

export function coverageError(draft: CoverageDraft): string | null {
  if (!draft.start || !draft.end) return '请补齐开始和结束日期';
  if (draft.end < draft.start) return '结束日期不能早于开始日期';
  return null;
}
