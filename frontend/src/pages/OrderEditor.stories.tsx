import type { Meta, StoryObj } from '@storybook/react-vite'
import { withRouter, reactRouterParameters } from 'storybook-addon-remix-react-router'
import { http, HttpResponse } from 'msw'
import { expect, userEvent } from 'storybook/test'
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
    await expect(await canvas.findByDisplayValue('测试订户')).toBeVisible()
    const month = canvas.getByPlaceholderText('选择月份')
    await userEvent.click(month)
    await userEvent.type(month, '2026-03')
    await userEvent.keyboard('{Enter}')
    await userEvent.click(canvas.getByText('订购与收件'))
    await expect(canvas.getByRole('spinbutton', { name: /单份套餐价/ })).toHaveValue('199.00')
    await expect(canvas.queryByDisplayValue('240')).not.toBeInTheDocument()
  },
}
