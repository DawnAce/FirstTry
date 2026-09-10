import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduleEntry } from '../api/schedule';
import ScheduleView from './ScheduleView';

const state = vi.hoisted(() => ({ rows: [] as ScheduleEntry[], isError: false, canMutate: false }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ canMutate: state.canMutate }) }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
    data: queryKey[0] === 'schedule-years' ? [2024, 2026] : state.rows,
    isLoading: false,
    isError: queryKey[0] === 'schedule' && state.isError,
  }),
}));

const row = (overrides: Partial<ScheduleEntry> = {}): ScheduleEntry => ({
  id: 1, year: 2026, issue_number: 2668, publish_date: '2026-09-07',
  is_suspended: false, page_count: 24, actual_page_count: null, ...overrides,
});

describe('ScheduleView publication display', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-10T04:00:00Z'));
    state.rows = [];
    state.isError = false;
    state.canMutate = false;
  });
  afterEach(() => vi.useRealTimers());

  it('labels historical schedule-only issues without inventing actual print data', () => {
    state.rows = [row({ year: 2024, publish_date: '2024-01-01' })];
    const html = renderToStaticMarkup(<ScheduleView />);
    expect(html).toContain('已出刊（按刊期）');
    expect(html).toContain('计划 24 版');
    expect(html).toContain('未录入印数');
    expect(html).toContain('暂无实际版数可对比');
    expect(html).not.toContain('实际 24 版');
    expect(html).not.toContain('导入期刊表');
  });

  it('keeps future issues unpublished even with print data and highlights the next date', () => {
    state.rows = [row(), row({ id: 2, publish_date: '2026-09-14', issue_number: 2669, actual_page_count: 16 })];
    const html = renderToStaticMarkup(<ScheduleView />);
    expect(html).toContain('mx-cell unpublished next');
    expect(html).toContain('调整 · 实际 16 版');
    expect(html).toContain('已对比 1 / 全年 2 期');
    expect(html).toContain('未出刊 1');
  });

  it('shows missing planned page counts as unavailable rather than a clean comparison', () => {
    state.rows = [row({ page_count: null, actual_page_count: 16 })];
    const html = renderToStaticMarkup(<ScheduleView />);
    expect(html).toContain('暂无计划版数可对比');
    expect(html).toContain('实际 16 版');
  });

  it('shows empty and failed loads without normal-month indicators or a misleading empty result', () => {
    let html = renderToStaticMarkup(<ScheduleView />);
    expect(html).toContain('暂无该年份刊期表');
    expect(html).toContain('暂无刊期');
    state.isError = true;
    html = renderToStaticMarkup(<ScheduleView />);
    expect(html).toContain('加载刊期表数据失败');
    expect(html).not.toContain('当前筛选条件下暂无刊期记录');
    expect(html).not.toContain('未出刊 0');
  });
});
