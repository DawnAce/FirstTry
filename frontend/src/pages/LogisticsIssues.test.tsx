import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PeriodRow } from '../api/logisticsOverview';
import LogisticsIssues from './LogisticsIssues';

const state = vi.hoisted(() => ({ rows: [] as PeriodRow[], isLoading: false, isError: false, canMutate: true }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ isAdmin: state.canMutate, canMutate: state.canMutate }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: state.isLoading ? undefined : { rows: state.rows }, isLoading: state.isLoading, isError: state.isError, refetch: vi.fn() }),
}));

const row = (year: number, issue_number: number): PeriodRow => ({
  year, issue_number, issue_id: issue_number, publish_date: `${year}-01-01`,
  status: '已上传', plan_status: '已就绪', waybill_status: '已完成',
  report_zt_total: 1, shipping_total: 1, actual_shipped_total: 1, handled_total: 1,
  pending_quantity: 0, delta: 0, is_match: true, detail_count: 1,
  has_shipping_drift: false, exception_note: '', last_updated_at: null,
});

const missing = (year: number, issue_number: number): PeriodRow => ({
  ...row(year, issue_number), issue_id: null, status: '未创建', plan_status: '未创建',
  waybill_status: '未开始', detail_count: 0, shipping_total: 0,
  actual_shipped_total: 0, handled_total: 0,
});

describe('LogisticsIssues published period view', () => {
  beforeEach(() => {
    // 总览接口按正式刊历排除未来日期；这里只使用已到出版日期的响应行。
    state.rows = [
      row(2025, 2600), missing(2026, 2670), row(2026, 2650),
      { ...row(2026, 2671), publish_date: '2026-10-12', waybill_status: '待上传', actual_shipped_total: 0, handled_total: 0, pending_quantity: 1 },
      { ...missing(2026, 2649), issue_id: 2649, status: '草稿', plan_status: '草稿' },
      { ...missing(2026, 2669), issue_id: 2669, status: '待上传', plan_status: '待导入' },
    ];
    state.isLoading = false;
    state.isError = false;
    state.canMutate = true;
  });

  it('defaults to the latest eligible year, descending issues, and keeps past missing work', () => {
    const html = renderToStaticMarkup(<LogisticsIssues mode="plan" />);
    expect(html).toContain('2026 年');
    expect(html).not.toContain('第 2600 期');
    expect(html.indexOf('第 2671 期')).toBeLessThan(html.indexOf('第 2670 期'));
    expect(html.indexOf('第 2670 期')).toBeLessThan(html.indexOf('第 2650 期'));
    expect(html).toContain('未创建 1');
    expect(html).toContain('待导入 1');
    expect(html).toContain('全部 5');
  });

  it('defaults actual shipments to the latest year and keeps plans awaiting waybills', () => {
    const html = renderToStaticMarkup(<LogisticsIssues mode="actual" />);
    expect(html).toContain('2026 年');
    expect(html.indexOf('第 2671 期')).toBeLessThan(html.indexOf('第 2650 期'));
    expect(html).not.toContain('第 2600 期');
    expect(html).not.toContain('第 2670 期');
    expect(html).not.toContain('第 2649 期');
    expect(html).not.toContain('第 2669 期');
    expect(html).toContain('待上传 1');
    expect(html).toContain('全部 2');
    expect(html).toContain('上传运单');
  });

  it('derives actual shipment years from rows with a plan', () => {
    state.rows = [row(2025, 2600), missing(2026, 2670)];
    const html = renderToStaticMarkup(<LogisticsIssues mode="actual" />);
    expect(html).toContain('2025 年');
    expect(html).not.toContain('2026 年');
    expect(html).toContain('第 2600 期');
  });

  it('shows empty actual shipments when no eligible period has a plan', () => {
    state.rows = [missing(2026, 2670)];
    const html = renderToStaticMarkup(<LogisticsIssues mode="actual" />);
    expect(html).toContain('全部年份');
    expect(html).toContain('全部 0');
    expect(html).not.toContain('第 2670 期');
  });

  it('keeps awaiting-waybill plans visible to readers without mutation controls', () => {
    state.canMutate = false;
    const html = renderToStaticMarkup(<LogisticsIssues mode="actual" />);
    expect(html).toContain('第 2671 期');
    expect(html).toContain('查看发货');
    expect(html).not.toContain('上传运单');
  });

  it('handles an empty response without inventing a year', () => {
    state.rows = [];
    const html = renderToStaticMarkup(<LogisticsIssues />);
    expect(html).toContain('全部年份');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('Infinity');
  });

  it('waits for data before choosing the newest year', () => {
    state.isLoading = true;
    const html = renderToStaticMarkup(<LogisticsIssues />);
    expect(html).toContain('全部年份');
    expect(html).not.toContain('第 2671 期');
  });

  it('still shows a load failure instead of a zero-row success', () => {
    state.isError = true;
    const html = renderToStaticMarkup(<LogisticsIssues />);
    expect(html).toContain('数据加载失败');
    expect(html).toContain('重新加载');
  });
});
