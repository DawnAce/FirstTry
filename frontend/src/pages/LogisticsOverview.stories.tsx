import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';
import { HttpResponse, http } from 'msw';
import { reactRouterParameters, withRouter } from 'storybook-addon-remix-react-router';
import type { PeriodRow } from '../api/logisticsOverview';
import LogisticsOverview from './LogisticsOverview';

const handlers = [
  http.get('/api/analytics/overview', () => HttpResponse.json({
    scope: 'workbench',
    year: 2026,
    rows: [{
      issue_number: 2653, issue_id: 1, year: 2026, publish_date: '2026-05-25',
      status: '已上传', plan_status: '已就绪', waybill_status: '部分完成',
      report_zt_total: 1473, shipping_total: 1473, actual_shipped_total: 1400,
      handled_total: 1400, pending_quantity: 73, delta: 0, is_match: true,
      detail_count: 77, has_shipping_drift: false, exception_note: '',
      last_updated_at: '2026-05-25T10:00:00',
    }],
    kpi: { total: 1, uploaded: 1, pending: 0, uncreated: 0, exception: 0, draft: 0 },
    extras: { recent_issues: [], upcoming_issues: [], reminders: { no_shipping_count: 0, delta_diff_count: 0, draft_unconfirmed_count: 0 }, latest_this_month: null },
  })),
  http.get('/api/operation-logs/recent', () => HttpResponse.json([])),
  http.get('/api/shipping-waybills/deferrals/pending', () => HttpResponse.json([
    {
      id: 1, issue_id: 1, issue_number: 2651, shipping_detail_id: 10,
      deferral_type: 'twice_monthly_consolidation', target_issue_number: 2653,
      target_publish_date: '2026-05-25', consolidation_batch: 'second_half', quantity: 2,
      reason: '每月两次合寄', status: 'pending', fulfilled_package_id: null,
      detail_name_snapshot: '测试收件人A', detail_phone_snapshot: '13800000001',
      detail_address_snapshot: '北京市示例地址A', detail_channel_snapshot: '个人订阅',
      created_by: 1, created_at: '2026-05-11T09:00:00', fulfilled_at: null,
    },
    {
      id: 2, issue_id: 2, issue_number: 2652, shipping_detail_id: 11,
      deferral_type: 'month_end_consolidation', target_issue_number: 2653,
      target_publish_date: '2026-05-25', consolidation_batch: 'month_end', quantity: 3,
      reason: '月底合寄', status: 'pending', fulfilled_package_id: null,
      detail_name_snapshot: '测试收件人B', detail_phone_snapshot: '13800000002',
      detail_address_snapshot: '北京市示例地址B', detail_channel_snapshot: '个人订阅',
      created_by: 1, created_at: '2026-05-18T09:00:00', fulfilled_at: null,
    },
    {
      id: 3, issue_id: 3, issue_number: 2600, shipping_detail_id: null,
      deferral_type: 'month_end_consolidation', target_issue_number: null,
      target_publish_date: null, consolidation_batch: null, quantity: 4,
      reason: '历史待办', status: 'pending', fulfilled_package_id: null,
      detail_name_snapshot: '历史收件人', detail_phone_snapshot: null,
      detail_address_snapshot: null, detail_channel_snapshot: '个人订阅',
      created_by: 1, created_at: '2025-12-01T09:00:00', fulfilled_at: null,
    },
  ])),
];

const meta = {
  title: '页面/发行履约/快递管理/总览',
  component: LogisticsOverview,
  decorators: [withRouter],
  parameters: {
    layout: 'fullscreen',
    reactRouter: reactRouterParameters({
      routing: { path: '/logistics' },
      location: { path: '/logistics' },
    }),
    msw: { handlers },
  },
} satisfies Meta<typeof LogisticsOverview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ConsolidationBacklog: Story = {
  name: '全系统合寄待办放在总览',
  play: async ({ canvas }) => {
    const backlog = await canvas.findByRole('button', { name: /全部未完成 3条 \/ 9份/ });
    await expect(backlog).toBeVisible();
    await userEvent.click(backlog);
    const dialog = await screen.findByRole('dialog', { name: '全部未完成合寄待办' });
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(within(dialog).getByText(/全系统当前未完成 3 条，共 9 份/)).toBeVisible();
  },
};

const publishedPlan: PeriodRow = {
  issue_number: 2671, issue_id: 1, year: 2026, publish_date: '2026-10-12',
  status: '已上传', plan_status: '已就绪', waybill_status: '待上传',
  report_zt_total: 10, shipping_total: 10, actual_shipped_total: 0,
  handled_total: 0, pending_quantity: 10, delta: 0, is_match: true,
  detail_count: 1, has_shipping_drift: false, exception_note: '', last_updated_at: null,
};

export const PublishedProgressAndForecast: Story = {
  name: '当前进度与后续出刊预告',
  parameters: {
    msw: { handlers: [
      http.get('/api/analytics/overview', () => HttpResponse.json({
        scope: 'workbench', year: 2026,
        rows: [publishedPlan, {
          ...publishedPlan, issue_number: 2670, issue_id: null, publish_date: '2026-10-05',
          status: '未创建', plan_status: '未创建', waybill_status: '未开始', detail_count: 0, shipping_total: 0,
        }],
        kpi: { total: 2, uploaded: 1, pending: 0, uncreated: 1, exception: 0, draft: 0 },
        extras: {
          recent_issues: [publishedPlan],
          upcoming_issues: [
            { ...publishedPlan, issue_number: 2672, publish_date: '2026-10-19' },
            { ...publishedPlan, issue_number: 2673, publish_date: '2026-10-26' },
          ],
          reminders: { no_shipping_count: 1, delta_diff_count: 0, draft_unconfirmed_count: 0 }, latest_this_month: null,
        },
      })),
      ...handlers.slice(1),
    ] },
  },
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByText('第 2671 期');
    await expect(canvas.getAllByText('占本年已到出版日期期数 50%')).toHaveLength(2);
    const cards = Array.from(canvasElement.querySelectorAll('.ui-metric-card-value')).map(card => card.textContent);
    await expect(cards).toEqual(['1期', '0期', '0期', '1期']);
    const forecast = canvas.getByText('后续期数').nextElementSibling;
    await expect(forecast?.textContent?.indexOf('第 2672 期')).toBeLessThan(forecast?.textContent?.indexOf('第 2673 期') ?? -1);
    await expect(canvas.getByRole('button', { name: /全部未完成 3条 \/ 9份/ })).toBeVisible();
  },
};

export const PublishedProgressDarkCompact: Story = {
  ...PublishedProgressAndForecast,
  name: '当前进度与出刊预告（暗色紧凑）',
  globals: { theme: 'dark', density: 'compact' },
};
