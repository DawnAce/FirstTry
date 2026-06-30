import type { Meta, StoryObj } from '@storybook/react-vite'
import { http, HttpResponse, delay } from 'msw'
import { expect, within } from 'storybook/test'
import CustomerList from './CustomerList'

// 客户管理（客户=收报人）：GET /api/customers 收报人聚合列表，
// 点击行打开抽屉触发 GET /api/customers/detail 取该收报人在订明细。
const list = {
  rows: [
    {
      recipient_name: '张伟', recipient_phone: '13800000001',
      primary_address: '北京市朝阳区建国路88号SOHO现代城A座1801',
      address_count: 2, order_count: 3, total_quantity: 5,
      publications: ['business_school', 'cbj'], last_order_date: '2026-06-12',
    },
    {
      recipient_name: '李娜', recipient_phone: null,
      primary_address: '上海市浦东新区世纪大道100号环球金融中心',
      address_count: 1, order_count: 1, total_quantity: 1,
      publications: ['cbj'], last_order_date: '2026-05-03',
    },
  ],
  total: 2,
}

const detail = {
  recipient_name: '张伟', recipient_phone: '13800000001',
  total_quantity: 5, order_count: 3, publications: ['business_school', 'cbj'],
  lines: [
    {
      target_id: 1, order_id: 101, order_code: 'CBJ-2026-0001', order_date: '2026-06-12',
      order_status: 'active', commercial_status: 'paid', publication: 'cbj',
      fulfillment_type: 'subscription', quantity: 2,
      coverage_start_date: '2026-07-01', coverage_end_date: '2026-12-31',
      issue_label: null, issue_number: null, shipping_channel: 'zto_outsource',
      recipient_address: '北京市朝阳区建国路88号SOHO现代城A座1801', target_status: 'active',
    },
    {
      target_id: 2, order_id: 102, order_code: 'BS-2026-0007', order_date: '2026-05-20',
      order_status: 'active', commercial_status: null, publication: 'business_school',
      fulfillment_type: 'single_issue', quantity: 1,
      coverage_start_date: null, coverage_end_date: null,
      issue_label: '2026-05', issue_number: null, shipping_channel: 'post_office',
      recipient_address: '北京市海淀区中关村大街1号', target_status: 'active',
    },
  ],
}

const meta = {
  title: '页面/CustomerList（客户管理·收报人）',
  component: CustomerList,
  tags: ['ai-generated'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          '客户管理（客户=收报人）：GET /api/customers 收报人聚合列表；点击行打开抽屉，GET /api/customers/detail 展示该收报人全部在订履约明细。演示 有数据 / 空 / 加载中。',
      },
    },
  },
} satisfies Meta<typeof CustomerList>

export default meta
type Story = StoryObj<typeof meta>

// 有数据：列表渲染收报人（姓名唯一，作为异步到达断言锚点）
export const Loaded: Story = {
  parameters: {
    msw: {
      handlers: [http.get('/api/customers', () => HttpResponse.json(list))],
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('张伟')).toBeVisible()
  },
}

// 交互：点击行打开抽屉，触发 GET /api/customers/detail 并渲染在订明细
// （Drawer 在 document.body 的 portal 中；订单号是详情独有锚点）
export const DetailDrawer: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/customers', () => HttpResponse.json(list)),
        http.get('/api/customers/detail', () => HttpResponse.json(detail)),
      ],
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByText('张伟'))
    await expect(
      await within(document.body).findByText('CBJ-2026-0001'),
    ).toBeVisible()
  },
}

// 空：列表返回空行，展示中文空态文案
export const Empty: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/customers', () => HttpResponse.json({ rows: [], total: 0 })),
      ],
    },
  },
}

// 加载中：列表接口不返回，表格保持 loading
export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/customers', async () => { await delay('infinite'); return HttpResponse.json(list) }),
      ],
    },
  },
}
