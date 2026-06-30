import type { Meta, StoryObj } from '@storybook/react-vite'
import { http, HttpResponse, delay } from 'msw'
import Analytics from './Analytics'

// 三个独立的 GET /api/analytics/* 分别驱动「按活动」「按期」「商学院发行量」三张表。
const campaigns = {
  rows: [
    { campaign: '2026-618', order_count: 42, total_paid: '12600.00', total_listed: '15000.00', total_discount: '2400.00' },
    { campaign: '2026-双十一', order_count: 18, total_paid: '5400.00', total_listed: '5400.00', total_discount: '0.00' },
  ],
  total_campaigns: 2, grand_total_orders: 60, grand_total_paid: '18000.00', grand_total_listed: '20400.00', grand_total_discount: '2400.00', date_from: null, date_to: null,
}

const issues = {
  rows: [
    { publication: 'business_school', issue_label: '2026-01', line_count: 12, total_quantity: 320, total_paid: '6400.00' },
    { publication: 'business_school', issue_label: '2026-02', line_count: 9, total_quantity: 210, total_paid: '4200.00' },
  ],
  total_issues: 2, grand_total_quantity: 530, grand_total_paid: '10600.00', date_from: null, date_to: null,
}

const bs = {
  rows: [
    { issue_label: '2026-01', year: 2026, title: '开年特刊', single_issue_qty: 120, subscription_qty: 480, total_qty: 600, in_calendar: true },
    { issue_label: '2026-02', year: 2026, title: null, single_issue_qty: 90, subscription_qty: 480, total_qty: 570, in_calendar: false },
  ],
  grand_total_single: 210, grand_total_subscription: 960, grand_total: 1170, unexpanded_subscriptions: 3, year: 2026,
}

const meta = {
  title: '页面/Analytics（活动订单统计）',
  component: Analytics,
  tags: ['ai-generated'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: '活动订单统计：三个 GET /api/analytics/*（campaigns / issues / bs-circulation）驱动三张统计表。演示 有数据 / 空 / 加载中。',
      },
    },
  },
} satisfies Meta<typeof Analytics>

export default meta
type Story = StoryObj<typeof meta>

// 有数据
export const Loaded: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/analytics/campaigns', () => HttpResponse.json(campaigns)),
        http.get('/api/analytics/issues', () => HttpResponse.json(issues)),
        http.get('/api/analytics/bs-circulation', () => HttpResponse.json(bs)),
      ],
    },
  },
}

// 空：三表都返回空行，展示各自的中文空态文案
export const Empty: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/analytics/campaigns', () => HttpResponse.json({ rows: [], total_campaigns: 0, grand_total_orders: 0, grand_total_paid: '0.00', grand_total_listed: '0.00', grand_total_discount: '0.00', date_from: null, date_to: null })),
        http.get('/api/analytics/issues', () => HttpResponse.json({ rows: [], total_issues: 0, grand_total_quantity: 0, grand_total_paid: '0.00', date_from: null, date_to: null })),
        http.get('/api/analytics/bs-circulation', () => HttpResponse.json({ rows: [], grand_total_single: 0, grand_total_subscription: 0, grand_total: 0, unexpanded_subscriptions: 0, year: 2026 })),
      ],
    },
  },
}

// 加载中：三个接口都不返回，三张表保持 loading
export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/analytics/campaigns', async () => { await delay('infinite'); return HttpResponse.json(campaigns) }),
        http.get('/api/analytics/issues', async () => { await delay('infinite'); return HttpResponse.json(issues) }),
        http.get('/api/analytics/bs-circulation', async () => { await delay('infinite'); return HttpResponse.json(bs) }),
      ],
    },
  },
}
