import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';
import { withRouter } from 'storybook-addon-remix-react-router';
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
