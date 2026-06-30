import type { Meta, StoryObj } from '@storybook/react-vite'
import { withRouter, reactRouterParameters } from 'storybook-addon-remix-react-router'
import { http, HttpResponse, delay } from 'msw'
import { expect } from 'storybook/test'
import OrderList from './OrderList'

// listOrders 返回 { rows, total }；一行已生效（带 order_code/漂移），一行草稿（order_code 为空 → 未生成）。
const rows = [
  { id: 1, order_code: 'CBJ-2026-0001', external_order_no: 'TB-88001', order_date: '2026-05-12', payer_name: '北京某某传媒有限公司', entry_method: 'manual', source_platform: '淘宝', campaign: '2026-618', total_quantity: 20, total_amount: '4800.00', coverage_start_date: '2026-06-01', coverage_end_date: '2027-05-31', status: 'active', has_drift: true, synced_count: 3, expected_total: 12 },
  { id: 2, order_code: null, external_order_no: null, order_date: '2026-05-20', payer_name: '张读者', entry_method: 'excel_import', source_platform: 'CBJ小程序', campaign: null, total_quantity: 1, total_amount: '240.00', coverage_start_date: null, coverage_end_date: null, status: 'draft', has_drift: false, synced_count: 0, expected_total: null },
]

const meta = {
  title: '页面/OrderList（订单列表）',
  component: OrderList,
  tags: ['ai-generated'],
  decorators: [withRouter],
  parameters: {
    layout: 'fullscreen',
    reactRouter: reactRouterParameters({ routing: { path: '/orders' } }),
    docs: {
      description: {
        component: '订单列表：单个 GET /api/orders 驱动可筛选/分页的表格。演示 有数据 / 空 / 加载中 三态。',
      },
    },
  },
} satisfies Meta<typeof OrderList>

export default meta
type Story = StoryObj<typeof meta>

// 有数据：表格渲染两行订单
export const Loaded: Story = {
  parameters: {
    msw: { handlers: [http.get('/api/orders', () => HttpResponse.json({ rows, total: rows.length }))] },
  },
  play: async ({ canvas }) => {
    // 异步数据到达：spinner 被替换为带订单编号的行
    await expect(await canvas.findByText('CBJ-2026-0001')).toBeVisible()
  },
}

// 空列表
export const Empty: Story = {
  parameters: {
    msw: { handlers: [http.get('/api/orders', () => HttpResponse.json({ rows: [], total: 0 }))] },
  },
}

// 加载中
export const Loading: Story = {
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
