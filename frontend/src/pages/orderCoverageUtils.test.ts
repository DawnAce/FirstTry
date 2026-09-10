import { describe, expect, it } from 'vitest';
import { coverageError, fillCoverage, monthCoverage } from './orderCoverageUtils';
import type { CoverageCandidate } from '../api/orderCoverage';

describe('批量补订期日期规则', () => {
  it('按自然月处理全年跨年、半年和闰年季度', () => {
    expect(monthCoverage('2026-03', 12)).toEqual({ start: '2026-03-01', end: '2027-02-28' });
    expect(monthCoverage('2026-09', 6)).toEqual({ start: '2026-09-01', end: '2027-02-28' });
    expect(monthCoverage('2023-12', 3)).toEqual({ start: '2023-12-01', end: '2024-02-29' });
  });
  it('只补空缺日期并提示无效范围', () => {
    const row = { coverage_start_date: '2026-05-15', coverage_end_date: null } as CoverageCandidate;
    const draft = fillCoverage(row, { start: '2026-01-01', end: '2026-03-31' });
    expect(draft.start).toBe('2026-05-15');
    expect(coverageError(draft)).toBe('结束日期不能早于开始日期');
    expect(coverageError({ start: null, end: null })).toBe('请补齐开始和结束日期');
  });
});
