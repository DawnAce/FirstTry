import type { Meta, StoryObj } from '@storybook/react-vite'
import { withRouter, reactRouterParameters } from 'storybook-addon-remix-react-router'
import { http, HttpResponse, delay } from 'msw'
import { expect } from 'storybook/test'
import OrderList from './OrderList'

// listOrders 返回 { rows, total }；一行已生效（带 order_code/漂移），一行草稿（order_code 为空 → 未生成）。
const rows = [
  { id: 1, order_code: 'CBJ-2026-0001', external_order_no: 'TB-88001', order_date: '2026-05-12', payer_name: '北京某某传媒有限公司', entry_method: 'manual', source_platform: '淘宝', campaign: '2026-618', total_quantity: 20, total_amount: '4800.00', paid_amount: '4800.00', outstanding_amount: '0.00', refunded_amount: '0.00', commercial_status: 'paid', coverage_start_date: '2026-06-01', coverage_end_date: '2027-05-31', status: 'active', has_drift: true, synced_count: 3, fulfilled_count: 3, expected_total: 12 },
  { id: 2, order_code: null, external_order_no: null, order_date: '2026-05-20', payer_name: '张读者', entry_method: 'excel_import', source_platform: 'CBJ小程序', campaign: null, total_quantity: 1, total_amount: '240.00', paid_amount: '0.00', outstanding_amount: '240.00', refunded_amount: '0.00', commercial_status: 'pending_payment', coverage_start_date: null, coverage_end_date: null, status: 'draft', has_drift: false, synced_count: 0, fulfilled_count: 0, expected_total: null },
]

const orderDetail = {
  id: 1, order_code: 'CBJ-2026-0001', external_order_no: 'TB-88001', order_date: '2026-05-12',
  payer_name: '北京某某传媒有限公司', total_amount: '4800.00', source_platform: '淘宝',
  items: [{
    publication: 'cbj', subscription_term: 'one_year', delivery_method: 'post_office',
    allocations: [{ targets: [{ status: 'active', recipient_name: '王女士' }] }],
  }],
}

const orderEvents = [
  { id: 1, event_type: 'confirmed', created_at: '2026-05-13T09:20:00+08:00' },
  { id: 2, event_type: 'created', created_at: '2026-05-12T16:30:00+08:00' },
]

const loadedHandlers = [
  http.get('/api/orders', () => HttpResponse.json({ rows, total: rows.length })),
  http.get('/api/orders/1', () => HttpResponse.json(orderDetail)),
  http.get('/api/orders/1/events', () => HttpResponse.json(orderEvents)),
]

const meta = {
  title: '页面/营销与交易/订单管理',
  component: OrderList,
  tags: ['ai-generated'],
  decorators: [withRouter],
  parameters: {
    layout: 'fullscreen',
    reactRouter: reactRouterParameters({ routing: { path: '/orders' } }),
    docs: {
      description: {
        component: '订单总览：状态视图、搜索筛选、分组列表与快速预览抽屉。演示有数据、空和加载三态。',
      },
    },
  },
} satisfies Meta<typeof OrderList>

export default meta
type Story = StoryObj<typeof meta>

// 有数据：表格渲染两行订单
export const Loaded: Story = {
  name: '已加载',
  parameters: {
    msw: { handlers: loadedHandlers },
  },
  play: async ({ canvas }) => {
    // 异步数据到达：spinner 被替换为带订单编号的行
    await expect(await canvas.findByText('CBJ-2026-0001')).toBeVisible()
  },
}

// 空列表
export const Empty: Story = {
  name: '空状态',
  parameters: {
    msw: { handlers: [http.get('/api/orders', () => HttpResponse.json({ rows: [], total: 0 }))] },
  },
}

// 加载中
export const Loading: Story = {
  name: '加载中',
  parameters: {
    msw: {
      handlers: [
        http.get('/api/orders', async () => {
          await delay('infinite')
          return HttpResponse.json({ rows: [], total: 0 })
        }),
      ],
    },
  },
}
