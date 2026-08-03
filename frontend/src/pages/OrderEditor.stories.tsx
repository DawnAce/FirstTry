import type { Meta, StoryObj } from '@storybook/react-vite'
import { withRouter, reactRouterParameters } from 'storybook-addon-remix-react-router'
import { http, HttpResponse } from 'msw'
import { expect } from 'storybook/test'
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
