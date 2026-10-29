import { describe, expect, it } from 'vitest';
import { demandSummary, expandDemandLines } from './channelDemandUtils';
import type { ScheduleEntry } from '../api/schedule';

describe('机构逐期需求', () => {
  it('正式刊期展开分项，跳过休刊，保留人工值与待确认的区别', () => {
    const rows: ScheduleEntry[] = [
      { id: 1, year: 2026, issue_number: 2601, publish_date: '2026-01-05', is_suspended: false },
      { id: 2, year: 2026, issue_number: null, publish_date: '2026-01-12', is_suspended: true },
    ];
    const result = expandDemandLines(rows, ['本市', '外埠'], [{ issue_number: 2601, sub_category: '本市', quantity: 0, review_status: 'confirmed' }]);
    expect(result).toHaveLength(2);
    expect(result[0].quantity).toBe(0);
    expect(result[0].review_status).toBe('confirmed');
    expect(result[1].quantity).toBeNull();
    expect(result[1].review_status).toBe('pending');
  });
  it('汇总只计已核对数量，待定建议值不进入合计', () => {
    expect(demandSummary([
      { issue_number: 1, sub_category: 'a', quantity: 15, review_status: 'confirmed' },
      { issue_number: 2, sub_category: 'a', quantity: 200, review_status: 'pending' },
      { issue_number: 3, sub_category: 'a', quantity: 0, review_status: 'none' },
    ])).toEqual({ quantity: 15, pending: 1, none: 1 });
  });
});
