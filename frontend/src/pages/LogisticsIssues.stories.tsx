import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';
import { withRouter } from 'storybook-addon-remix-react-router';
import { expect, waitFor, within } from 'storybook/test';
import type { PeriodRow } from '../api/logisticsOverview';
import LogisticsIssues from './LogisticsIssues';

const baseRow: PeriodRow = {
  issue_number: 2653,
  issue_id: 1,
  year: 2026,
  publish_date: '2026-05-25',
  status: '已上传',
  plan_status: '已就绪',
  waybill_status: '已完成',
  report_zt_total: 1473,
  shipping_total: 1473,
  actual_shipped_total: 1473,
  handled_total: 1473,
  pending_quantity: 0,
  delta: 0,
  is_match: true,
  detail_count: 77,
  has_shipping_drift: false,
  exception_note: '—',
  last_updated_at: '2026-05-25T14:20:00',
};

const rows: PeriodRow[] = [
  baseRow,
  { ...baseRow, issue_number: 2654, issue_id: 2, publish_date: '2026-06-01', waybill_status: '部分完成', actual_shipped_total: 901, handled_total: 901, pending_quantity: 572 },
  { ...baseRow, issue_number: 2655, issue_id: 3, publish_date: '2026-06-08', plan_status: '有差异', waybill_status: '待上传', shipping_total: 1420, actual_shipped_total: 0, handled_total: 0, pending_quantity: 1420, delta: 53, is_match: false },
  { ...baseRow, issue_number: 2656, issue_id: 4, publish_date: '2026-06-15', plan_status: '有变更', waybill_status: '需核对', shipping_total: 1500, actual_shipped_total: 1473, handled_total: 1473, pending_quantity: 27, has_shipping_drift: true },
  { ...baseRow, issue_number: 2657, issue_id: 5, publish_date: '2026-06-22', status: '待上传', plan_status: '待导入', waybill_status: '未开始', shipping_total: 0, actual_shipped_total: 0, handled_total: 0, pending_quantity: 0, detail_count: 0 },
];

const meta = {
  title: '页面/发行履约/快递管理/二级列表',
  component: LogisticsIssues,
  decorators: [withRouter],
  parameters: {
    msw: {
      handlers: [
        http.get('/api/analytics/overview', () => HttpResponse.json({
          scope: 'periods',
          year: null,
          rows,
          kpi: { total: 5, uploaded: 4, pending: 1, uncreated: 0, exception: 2, draft: 0 },
          extras: null,
        })),
      ],
    },
  },
} satisfies Meta<typeof LogisticsIssues>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ShippingPlans: Story = { name: '发货计划', args: { mode: 'plan' } };
export const ActualShipments: Story = { name: '实际发货', args: { mode: 'actual' } };

// 模拟服务端截至 2026-10-14 返回的已到出版日期期次；未来刊期的排除由服务测试覆盖。
const publishedRows: PeriodRow[] = [
  { ...baseRow, year: 2025, issue_number: 2600, publish_date: '2025-12-29' },
  { ...baseRow, issue_number: 2652, publish_date: '2026-09-28', issue_id: null, status: '未创建', plan_status: '未创建', waybill_status: '未开始', detail_count: 0, report_zt_total: 0, shipping_total: 0, actual_shipped_total: 0, handled_total: 0 },
  { ...baseRow, publish_date: '2026-10-05' },
  { ...baseRow, issue_number: 2654, publish_date: '2026-10-12', waybill_status: '待上传', actual_shipped_total: 0, handled_total: 0, pending_quantity: 1473 },
];
const publishedParameters = {
  msw: {
    handlers: [http.get('/api/analytics/overview', () => HttpResponse.json({
      scope: 'periods', year: null, rows: publishedRows,
      kpi: { total: 4, uploaded: 3, pending: 0, uncreated: 1, exception: 0, draft: 0 }, extras: null,
    }))],
  },
};

export const LatestYearFirst: Story = {
  name: '发货计划 · 已到出版日期的最新年份与期数优先',
  args: { mode: 'plan' },
  parameters: publishedParameters,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const issues = () => Array.from(canvasElement.querySelectorAll('tbody .logistics-period-cell')).map(cell => cell.textContent);
    await waitFor(() => expect(issues()).toEqual(['第 2654 期', '第 2653 期', '第 2652 期']));
    await expect(canvas.getByText('2026 年')).toBeVisible();
    await expect(canvas.getByText('全部 3')).toBeVisible();
    await userEvent.click(canvas.getByText('未创建 1'));
    await waitFor(() => expect(issues()).toEqual(['第 2652 期']));
    await userEvent.click(canvas.getByText('全部 3'));
    const year = canvas.getByRole('combobox', { name: '年份' });
    const body = within(document.body);
    await userEvent.click(year);
    await expect(body.queryByText('2027 年', { selector: '.ant-select-item-option-content' })).not.toBeInTheDocument();
    await userEvent.click(await body.findByText('2025 年', { selector: '.ant-select-item-option-content' }));
    await waitFor(() => expect(issues()).toEqual(['第 2600 期']));
    await userEvent.type(canvas.getByPlaceholderText('搜索期号'), '2653');
    await waitFor(() => expect(issues()).toEqual([]));
    await userEvent.clear(canvas.getByPlaceholderText('搜索期号'));
    await expect(canvas.getByText('2025 年')).toBeVisible();
    await userEvent.click(year);
    await userEvent.click(await body.findByText('全部年份', { selector: '.ant-select-item-option-content' }));
    await waitFor(() => expect(issues()).toEqual(['第 2654 期', '第 2653 期', '第 2652 期', '第 2600 期']));
    await userEvent.click(canvas.getByRole('columnheader', { name: /期数/ }));
    await waitFor(() => expect(issues()).toEqual(['第 2600 期', '第 2652 期', '第 2653 期', '第 2654 期']));
  },
};

export const LatestYearFirstDarkCompact: Story = {
  ...LatestYearFirst,
  name: '发货计划 · 最新年份优先（暗色紧凑）',
  globals: { theme: 'dark', density: 'compact' },
};

export const ActualLatestYearFirst: Story = {
  name: '实际发货 · 最新年份优先并保留待上传',
  args: { mode: 'actual' },
  parameters: {
    ...publishedParameters,
    auth: { user: { id: 1, username: 'test-admin', role: 'admin' }, isAdmin: true, isLoggedIn: true, canMutate: true, setAuth: () => {}, logout: () => {} },
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const issues = () => Array.from(canvasElement.querySelectorAll('tbody .logistics-period-cell')).map(cell => cell.textContent);
    await waitFor(() => expect(issues()).toEqual(['第 2654 期', '第 2653 期']));
    await expect(canvas.getByText('2026 年')).toBeVisible();
    await expect(canvas.getByText('全部 2')).toBeVisible();
    await expect(canvas.getByRole('button', { name: /上传运单/ })).toBeVisible();
    await userEvent.click(canvas.getByText('待上传 1'));
    await waitFor(() => expect(issues()).toEqual(['第 2654 期']));
    await userEvent.click(canvas.getByText('全部 2'));
    await userEvent.click(canvas.getByRole('combobox', { name: '年份' }));
    await userEvent.click(await within(document.body).findByText('全部年份', { selector: '.ant-select-item-option-content' }));
    await waitFor(() => expect(issues()).toEqual(['第 2654 期', '第 2653 期', '第 2600 期']));
    await userEvent.type(canvas.getByPlaceholderText('搜索期号'), '2600');
    await waitFor(() => expect(issues()).toEqual(['第 2600 期']));
  },
};

export const ActualLatestYearFirstDarkCompact: Story = {
  ...ActualLatestYearFirst,
  name: '实际发货 · 最新年份优先（暗色紧凑）',
  globals: { theme: 'dark', density: 'compact' },
};

export const PublishedPagination: Story = {
  name: '发货计划 · 倒序分页与搜索',
  args: { mode: 'plan' },
  parameters: {
    msw: {
      handlers: [http.get('/api/analytics/overview', () => HttpResponse.json({
        scope: 'periods', year: null,
        rows: Array.from({ length: 25 }, (_, index) => ({
          ...baseRow, issue_number: 2700 + index, publish_date: `2026-06-${String(index + 1).padStart(2, '0')}`,
        })),
        kpi: { total: 25, uploaded: 25, pending: 0, uncreated: 0, exception: 0, draft: 0 }, extras: null,
      }))],
    },
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const issues = () => Array.from(canvasElement.querySelectorAll('tbody .logistics-period-cell')).map(cell => cell.textContent);
    await waitFor(() => expect(issues()).toHaveLength(20));
    await expect(issues()[0]).toBe('第 2724 期');
    await expect(issues()[19]).toBe('第 2705 期');
    await userEvent.click(canvasElement.querySelector('.ant-pagination-item-2')!);
    await waitFor(() => expect(issues()).toEqual(['第 2704 期', '第 2703 期', '第 2702 期', '第 2701 期', '第 2700 期']));
    await userEvent.type(canvas.getByPlaceholderText('搜索期号'), '2724');
    await waitFor(() => expect(issues()).toEqual(['第 2724 期']));
    await expect(canvas.getAllByText('共 1 期').length).toBeGreaterThan(0);
    await expect(canvas.getByText('全部 25')).toBeVisible();
  },
};
