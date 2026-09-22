import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import { coverageEnd, existingCoverage } from './orderCoverage';

describe('按刊期起订', () => {
  it('起投日起满一年与自然月全年分别计算', () => {
    expect(coverageEnd('one_year', dayjs('2026-06-08'), 'issue').format('YYYY-MM-DD')).toBe('2027-06-07');
    expect(coverageEnd('one_year', dayjs('2026-06-08'), 'month').format('YYYY-MM-DD')).toBe('2027-05-31');
    expect(coverageEnd('half_year', dayjs('2026-08-31'), 'issue').format('YYYY-MM-DD')).toBe('2027-02-27');
    expect(coverageEnd('one_year', dayjs('2024-02-29'), 'issue').format('YYYY-MM-DD')).toBe('2025-02-27');
  });
  it('已有实际日期原样恢复，保留一年套餐和手动结束日', () => {
    const restored = existingCoverage({ coverage_start_mode: 'issue', subscription_term: 'one_year',
      coverage_start_date: '2026-06-08', coverage_end_date: '2027-05-31' });
    expect(restored.mode).toBe('issue');
    expect(restored.adjusted).toBe(true);
    expect(restored.end?.format('YYYY-MM-DD')).toBe('2027-05-31');
    expect(existingCoverage({ subscription_term: 'one_year', coverage_start_date: '2026-06-08', coverage_end_date: '2027-06-07' }).mode).toBe('date');
  });
});
