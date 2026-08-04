import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';
import { expect, within } from 'storybook/test';

import { ComplaintHandlingDrawer } from './PostDelivery';

const complaint = {
  id: 701,
  postal_delivery_id: 501,
  order_id: 96,
  external_order_no: '2026-6352',
  complaint_date: '2026-08-04',
  complaint_source: '客服中心',
  source_platform: '微信小程序',
  year: 2026,
  missing_issues: '宋女士反馈漏收第 3001 期',
  handling: '核实邮局投递后安排中通补发',
  routed_label: '北京集订分送',
  routed_unit_id: 12,
  routed_unit_name: '北京集订分送',
  follow_up: null,
  handling_count: 1,
  status: 'in_progress',
  first_handler: '客服小李',
  snap_name: '宋女士',
  snap_phone: '13800008821',
  snap_address: '北京市朝阳区建国路 88 号',
  snap_postal_code: '100022',
  notes: null,
  updated_at: '2026-08-04T15:20:00',
};

const makeup = {
  id: 801,
  complaint_id: 701,
  order_id: 96,
  postal_delivery_id: 501,
  recipient_name: '宋女士',
  recipient_phone: '13800008821',
  recipient_address: '北京市朝阳区建国路 88 号',
  status: 'shipped',
  tracking_no: 'ZT20260804001',
  shipped_at: '2026-08-04T15:20:00',
  notes: '漏收补发',
  created_by: 1,
  created_at: '2026-08-04T14:30:00',
  updated_at: '2026-08-04T15:20:00',
  items: [{ id: 901, issue_number: 3001, quantity: 1, shipping_detail_id: 1001, shipped_at: '2026-08-04T15:20:00', shipped_quantity: 1, tracking_no: 'ZT20260804001' }],
};

const meta = {
  title: '页面/邮局投递/投诉补发闭环',
  component: ComplaintHandlingDrawer,
  tags: ['ai-generated'],
  parameters: {
    layout: 'fullscreen',
    auth: { user: { username: 'admin', role: 'admin' }, isAdmin: true, isLoggedIn: true, setAuth: () => {}, logout: () => {} },
    msw: {
      handlers: [
        http.get('/api/postal/tickets/701', () => HttpResponse.json({
          type: 'complaint',
          complaint,
          handlings: [
            { id: 1002, complaint_id: 701, event_type: 'makeup_shipped', source_ticket_id: null, handled_at: '2026-08-04T15:20:00', handled_by: 1, handled_by_name: 'admin', action: '中通补发已发出，运单号 ZT20260804001', follow_result: null, result_status: 'in_progress' },
            { id: 1001, complaint_id: 701, event_type: 'makeup_created', source_ticket_id: null, handled_at: '2026-08-04T14:30:00', handled_by: 1, handled_by_name: 'admin', action: '创建中通补发任务 #801：第 3001 期×1份', follow_result: null, result_status: 'in_progress' },
          ],
        })),
        http.get('/api/postal/makeups', () => HttpResponse.json({ rows: [makeup], total: 1 })),
        http.get('/api/issues', () => HttpResponse.json([
          { id: 3001, issue_number: 3001, publish_date: '2026-08-03', status: 'confirmed', page_count: 24, planned_page_count: 24, year_issue_index: 31, year_issue_label: '2026年第31期', notes: null, created_at: '2026-08-01T00:00:00', updated_at: '2026-08-03T00:00:00' },
        ])),
      ],
    },
  },
  args: { complaintId: 701, onClose: () => {} },
} satisfies Meta<typeof ComplaintHandlingDrawer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ShippedMakeup: Story = {
  name: '已发出补发任务',
  play: async () => {
    const body = within(document.body);
    await expect(await body.findByText('投诉详情')).toBeVisible();
    await expect(await body.findByText('补发属于本投诉工单的处理任务')).toBeVisible();
    await expect(await body.findByText('补发任务 #801')).toBeVisible();
    await expect(await body.findByText('ZT20260804001')).toBeVisible();
    await expect(await body.findByText('创建并同步 ZTO-MF')).toBeVisible();
  },
};
