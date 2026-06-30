import type { Meta, StoryObj } from '@storybook/react-vite'
import { http, HttpResponse, delay } from 'msw'
import { expect, within, waitFor } from 'storybook/test'
import FinanceManagement from './FinanceManagement'

// 财务管理：GET /api/invoices/orders（发票工作台）+ GET /api/settlements（渠道结算）
// + GET /api/partners（结算筛选/下拉）。写操作按 isAdmin 显隐。
const TS = '2026-06-01T00:00:00Z'

const invoiceOrders = {
  rows: [
    {
      order_id: 1, order_code: 'CBJ-2026-0001', payer_name: '北京某公司', order_date: '2026-06-01',
      total_amount: '360.00', refunded_amount: '0.00', invoice_required: true,
      invoice_title: '北京某公司', invoice_tax_no: '91110000XXXXXX', invoices: [],
      invoice_state: 'pending', needs_red_reversal: false, order_voided: false,
    },
    {
      order_id: 2, order_code: 'CBJ-2026-0002', payer_name: '上海某单位', order_date: '2026-05-20',
      total_amount: '240.00', refunded_amount: '60.00', invoice_required: true,
      invoice_title: '上海某单位', invoice_tax_no: null,
      invoices: [{ id: 10, order_id: 2, invoice_type: 'normal', invoice_no: 'INV-2002', amount: '240.00', issued_date: '2026-05-21', buyer_title: '上海某单位', tax_no: null, notes: null, created_at: TS, updated_at: TS }],
      invoice_state: 'needs_red_reversal', needs_red_reversal: true, order_voided: false,
    },
  ],
  total: 2, pending_count: 1, needs_red_reversal_count: 1,
}

const settlements = [
  { id: 1, partner_id: 1, partner_name: '中通', contract_id: null, period: '2026-Q1', amount_due: '120000.00', paid_amount: '120000.00', paid_date: '2026-04-10', on_time: true, invoice_received: true, invoice_no: 'ZT-FP-001', status: 'invoiced', attachment_filename: '结算单.pdf', has_attachment: true, notes: null, created_at: TS, updated_at: TS },
  { id: 2, partner_id: 2, partner_name: '北京市报刊发行局', contract_id: null, period: '2026-Q1', amount_due: '50000.00', paid_amount: null, paid_date: null, on_time: null, invoice_received: false, invoice_no: null, status: 'pending', attachment_filename: null, has_attachment: false, notes: null, created_at: TS, updated_at: TS },
]

const partners = [
  { id: 1, name: '中通', partner_type: 'logistics', contact_person: null, contact_phone: null, settlement_account: null, notes: null, active: true, created_at: TS, updated_at: TS },
  { id: 2, name: '北京市报刊发行局', partner_type: 'distribution', contact_person: null, contact_phone: null, settlement_account: null, notes: null, active: true, created_at: TS, updated_at: TS },
]

const adminAuth = { user: { id: 1, username: 'admin', role: 'admin' }, isAdmin: true, isLoggedIn: true, setAuth: () => {}, logout: () => {} }
const operatorAuth = { user: { id: 2, username: 'op', role: 'operator' }, isAdmin: false, isLoggedIn: true, setAuth: () => {}, logout: () => {} }

const dataHandlers = [
  http.get('/api/invoices/orders', () => HttpResponse.json(invoiceOrders)),
  http.get('/api/settlements', () => HttpResponse.json(settlements)),
  http.get('/api/partners', () => HttpResponse.json(partners)),
]

const meta = {
  title: '页面/FinanceManagement（财务管理）',
  component: FinanceManagement,
  tags: ['ai-generated'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          '财务管理：「订单发票」工作台（待开票/已开票/需冲红）+「渠道结算」（对账打款/进项发票/附件归档）。写操作按 isAdmin 显隐。演示 管理员/操作员（只读）/空/登记发票弹窗/切到结算页。',
      },
    },
  },
} satisfies Meta<typeof FinanceManagement>

export default meta
type Story = StoryObj<typeof meta>

// 管理员：发票工作台 + 登记入口
export const Loaded: Story = {
  parameters: { auth: adminAuth, msw: { handlers: dataHandlers } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('CBJ-2026-0001')).toBeVisible()
    expect((await canvas.findAllByRole('button', { name: /登记发票/ })).length).toBeGreaterThan(0)
  },
}

// 操作员（只读）：无登记按钮
export const OperatorReadonly: Story = {
  parameters: { auth: operatorAuth, msw: { handlers: dataHandlers } },
  play: async ({ canvas }) => {
    await canvas.findByText('CBJ-2026-0001')
    expect(canvas.queryByRole('button', { name: /登记发票/ })).toBeNull()
  },
}

// 交互：点「登记发票」打开弹窗
export const RegisterInvoice: Story = {
  parameters: { auth: adminAuth, msw: { handlers: dataHandlers } },
  play: async ({ canvas, userEvent }) => {
    const buttons = await canvas.findAllByRole('button', { name: /登记发票/ })
    await userEvent.click(buttons[0])
    const dialog = await within(document.body).findByRole('dialog')
    await waitFor(() => expect(dialog).toBeVisible())
  },
}

// 交互：切到「渠道结算」页签，结算行渲染
export const SettlementsTab: Story = {
  parameters: { auth: adminAuth, msw: { handlers: dataHandlers } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('tab', { name: '渠道结算' }))
    await expect(await canvas.findByText('中通')).toBeVisible()
  },
}

// 空
export const Empty: Story = {
  parameters: {
    auth: adminAuth,
    msw: {
      handlers: [
        http.get('/api/invoices/orders', () => HttpResponse.json({ rows: [], total: 0, pending_count: 0, needs_red_reversal_count: 0 })),
        http.get('/api/settlements', () => HttpResponse.json([])),
        http.get('/api/partners', () => HttpResponse.json([])),
      ],
    },
  },
}

// 加载中
export const Loading: Story = {
  parameters: {
    auth: adminAuth,
    msw: {
      handlers: [
        http.get('/api/invoices/orders', async () => { await delay('infinite'); return HttpResponse.json(invoiceOrders) }),
        http.get('/api/settlements', () => HttpResponse.json(settlements)),
        http.get('/api/partners', () => HttpResponse.json(partners)),
      ],
    },
  },
}
