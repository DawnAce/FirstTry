import type { Meta, StoryObj } from '@storybook/react-vite'
import { withRouter, reactRouterParameters } from 'storybook-addon-remix-react-router'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, within, waitFor } from 'storybook/test'
import OrderEditor from './OrderEditor'

const meta = {
  title: '页面/营销与交易/订单快速录入',
  component: OrderEditor,
  tags: ['ai-generated'],
  decorators: [withRouter],
  parameters: {
    reactRouter: reactRouterParameters({ routing: { path: '/orders/new' } }),
    msw: {
      handlers: [
        http.get('/api/schedule/years', () => HttpResponse.json([2026, 2027])),
        http.get('/api/schedule', () => HttpResponse.json([
          { id: 1, year: 2026, issue_number: 2654, publish_date: '2026-06-01', is_suspended: false },
          { id: 2, year: 2026, issue_number: 2655, publish_date: '2026-06-08', is_suspended: false },
        ])),
        http.post('/api/orders/coverage-preview', () => HttpResponse.json({
          first_issue: { issue_number: 2655, publish_date: '2026-06-08' },
          last_issue: { issue_number: 2704, publish_date: '2027-06-07' }, expected_issue_count: 50, schedule_incomplete: false,
        })),
        http.post('/api/orders/pricing-preview', () =>
          HttpResponse.json({
            month_range_label: '2026-08 至 2027-07',
            coverage_start_date: '2026-08-03',
            coverage_end_date: '2027-07-26',
            expected_issue_count: 49,
            unit_price: '240.00',
            subtotal: '240.00',
            price_label: '邮局投递 · 一年',
            schedule_incomplete: false,
            warning: null,
          }),
        ),
      ],
    },
  },
} satisfies Meta<typeof OrderEditor>

export default meta
type Story = StoryObj<typeof meta>

export const QuickEntry: Story = {
  name: '单页快速录入',
  play: async ({ canvas }) => {
    await expect(canvas.getByText('客户与商品')).toBeVisible()
    await expect(canvas.getByText('来源与收款')).toBeVisible()
    await expect(canvas.getByText('订购与收件')).toBeVisible()
    await expect(canvas.getByLabelText('来源平台')).toBeRequired()
    await expect(canvas.getByLabelText('来源店铺')).toBeRequired()
    await expect(canvas.getByLabelText('来源单号')).toBeRequired()
    await expect(canvas.getByLabelText('已付金额')).toBeRequired()
  },
}

export const ImportedPromoCoverage: Story = {
  name: '导入促销单补日期保留成交价',
  parameters: {
    reactRouter: reactRouterParameters({ location: { pathParams: { id: '101' } }, routing: { path: '/orders/:id/edit' } }),
    msw: { handlers: [
      http.post('/api/orders/coverage-preview', () => HttpResponse.json({
        first_issue: null, last_issue: null, expected_issue_count: 0, schedule_incomplete: true,
      })),
      http.get('/api/orders/101', () => HttpResponse.json({
        id: 101, order_code: 'ORD-SYNTHETIC-101', external_order_no: 'SYNTHETIC-101',
        order_date: '2026-02-01', entry_method: 'excel_import', source_platform: 'CBJ小程序',
        payer_name: '测试订户', paid_amount: '199.00', total_amount: '199.00', status: 'active',
        items: [{ id: 501, publication: 'cbj', fulfillment_type: 'subscription', billing_type: 'paid',
          subscription_term: 'one_year', delivery_method: 'post_office', total_quantity: 1,
          unit_price: '199.00', subtotal: '199.00', coverage_start_date: null, coverage_end_date: null, allocations: [] }],
      })),
      http.post('/api/orders/pricing-preview', () => HttpResponse.json({
        coverage_start_date: '2026-03-02', coverage_end_date: '2027-02-22', unit_price: '240.00', subtotal: '240.00', expected_issue_count: 48,
      })),
    ] },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTitle('微信小程序')).toBeVisible()
    await expect(await canvas.findByTitle('CBJ+')).toBeVisible()
    await expect(await canvas.findByDisplayValue('测试订户')).toBeVisible()
    const month = canvas.getByPlaceholderText('选择月份')
    await userEvent.click(month)
    await userEvent.type(month, '2026-03')
    await userEvent.keyboard('{Enter}')
    await userEvent.click(canvas.getByText('订购与收件'))
    await expect(await canvas.findByRole('spinbutton', { name: /单份套餐价/ })).toHaveValue('199.00')
    await expect(canvas.queryByDisplayValue('240')).not.toBeInTheDocument()
  },
}

const syntheticIssueOrder = (saved = false) => ({
  id: 102, order_code: 'ORD-SYNTHETIC-102', external_order_no: 'SYNTHETIC-102',
  order_date: '2026-06-01', entry_method: 'excel_import', source_platform: '微信小程序', source_store: 'CBJ+',
  payer_name: '合成测试订户', paid_amount: '199.00', total_amount: '199.00', status: 'active', invoice_required: false,
  items: [{ id: 502, publication: 'cbj', publication_format: 'paper', fulfillment_type: 'subscription', billing_type: 'paid',
    subscription_term: 'one_year', delivery_method: 'zto_mf', total_quantity: 1, status: 'active',
    unit_price: '199.00', subtotal: '199.00', coverage_start_mode: saved ? 'issue' : null,
    coverage_start_issue: saved ? 2655 : null,
    coverage_start_date: saved ? '2026-06-08' : null, coverage_end_date: saved ? '2027-05-31' : null,
    allocations: [{ id: 602, version_no: 1, effective_until_issue: null, targets: [
      { id: 702, shipping_channel: 'zto_outsource', distribution_unit_id: null, effective_from_issue: 2655, effective_until_issue: 2704, recipient_name: '合成收件人', recipient_address: '合成测试地址', quantity: 1, status: 'active' },
    ] }],
  }],
})
let savedIssuePayload: Record<string, unknown> | null = null
const issueHandlers = (saved = false) => [
  http.get('/api/orders/102', () => HttpResponse.json(syntheticIssueOrder(saved))),
  http.get('/api/schedule/years', () => HttpResponse.json([2026, 2027])),
  http.get('/api/schedule', () => HttpResponse.json([
    { id: 1, year: 2026, issue_number: 2654, publish_date: '2026-06-01', is_suspended: false },
    { id: 2, year: 2026, issue_number: 2655, publish_date: '2026-06-08', is_suspended: false },
    { id: 3, year: 2026, issue_number: null, publish_date: '2026-06-15', is_suspended: true },
  ])),
  http.post('/api/orders/coverage-preview', async ({ request }) => {
    const body = await request.json() as { coverage_start_date: string; coverage_end_date: string }
    return HttpResponse.json({ first_issue: { issue_number: 2655, publish_date: body.coverage_start_date },
      last_issue: { issue_number: body.coverage_end_date === '2027-05-31' ? 2703 : 2704, publish_date: body.coverage_end_date },
      expected_issue_count: 50, schedule_incomplete: false })
  }),
  http.put('/api/orders/102', async ({ request }) => { savedIssuePayload = await request.json() as Record<string, unknown>; return HttpResponse.json(syntheticIssueOrder(true)) }),
]

export const IssueStartWithAnnualTerm: Story = {
  name: '一年订阅按具体刊期起订并保存',
  parameters: {
    reactRouter: reactRouterParameters({ location: { pathParams: { id: '102' } }, routing: { path: '/orders/:id/edit' } }),
    msw: { handlers: issueHandlers() },
  },
  beforeEach: () => { savedIssuePayload = null },
  play: async ({ canvas }) => {
    const body = within(document.body)
    await expect(await canvas.findByDisplayValue('合成测试订户')).toBeVisible()
    await userEvent.click(canvas.getByRole('radio', { name: /按具体刊期起订/ }))
    await userEvent.click(canvas.getByRole('combobox', { name: '起投刊期' }))
    await userEvent.click(await body.findByText('第 2655 期 · 2026-06-08'))
    await expect(canvas.getByPlaceholderText('结束日期')).toHaveValue('2027-06-07')
    await expect(canvas.getByRole('radio', { name: '一年' })).toBeChecked()
    await expect(await canvas.findByRole('spinbutton', { name: /单份套餐价/ })).toHaveValue('199.00')
    await userEvent.click(canvas.getByRole('button', { name: '调整' }))
    const end = canvas.getByPlaceholderText('结束日期')
    await userEvent.clear(end)
    await userEvent.type(end, '2027-05-31')
    await userEvent.keyboard('{Enter}')
    await userEvent.click(canvas.getByText('订购与收件'))
    await expect(end).toHaveValue('2027-05-31')
    await expect(canvas.getByRole('radio', { name: '一年' })).toBeChecked()
    await userEvent.type(canvas.getByPlaceholderText('如 2660'), '2655')
    await userEvent.click(canvas.getByRole('button', { name: /保存变更/ }))
    await waitFor(() => expect(savedIssuePayload).toMatchObject({ items_update: { effective_from_issue: 2655, items: [
      { id: 502, coverage_start_mode: 'issue', coverage_start_issue: 2655, coverage_start_date: '2026-06-08',
        coverage_end_date: '2027-05-31', subscription_term: 'one_year', unit_price: 199,
        targets: [{ shipping_channel: 'zto_outsource', distribution_unit_id: null, effective_from_issue: 2655, effective_until_issue: 2704 }] },
    ] } }))
  },
}

export const SavedIssueCoverage: Story = {
  name: '重新打开保留起投刊期和已调整结束日',
  parameters: {
    reactRouter: reactRouterParameters({ location: { pathParams: { id: '102' } }, routing: { path: '/orders/:id/edit' } }),
    msw: { handlers: issueHandlers(true) },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByDisplayValue('合成测试订户')).toBeVisible()
    await expect(canvas.getByRole('radio', { name: /按具体刊期起订/ })).toBeChecked()
    await expect(canvas.getByPlaceholderText('结束日期')).toHaveValue('2027-05-31')
    await expect(await canvas.findByRole('spinbutton', { name: /单份套餐价/ })).toHaveValue('199.00')
    await userEvent.click(canvas.getByRole('button', { name: '恢复自动计算' }))
    await expect(canvas.getByPlaceholderText('结束日期')).toHaveValue('2027-06-07')
  },
}

let scheduleUnavailable = true
export const IssueListFailure: Story = {
  name: '刊期加载失败可重试且不能误选',
  parameters: {
    reactRouter: reactRouterParameters({ location: { pathParams: { id: '102' } }, routing: { path: '/orders/:id/edit' } }),
    msw: { handlers: [
      http.get('/api/schedule', () => scheduleUnavailable
        ? new HttpResponse(null, { status: 503 })
        : HttpResponse.json([{ id: 2, year: 2026, issue_number: 2655, publish_date: '2026-06-08', is_suspended: false }])),
      ...issueHandlers(),
    ] },
  },
  beforeEach: () => { scheduleUnavailable = true },
  play: async ({ canvas }) => {
    await expect(await canvas.findByDisplayValue('合成测试订户')).toBeVisible()
    await userEvent.click(canvas.getByRole('radio', { name: /按具体刊期起订/ }))
    await expect(await canvas.findByText('刊期加载失败')).toBeVisible()
    await expect(canvas.getByRole('combobox', { name: '起投刊期' })).toBeDisabled()
    scheduleUnavailable = false
    await userEvent.click(canvas.getByRole('button', { name: /重\s*试/ }))
    await waitFor(() => expect(canvas.getByRole('combobox', { name: '起投刊期' })).not.toBeDisabled())
  },
}
