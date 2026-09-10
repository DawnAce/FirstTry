import type { Meta, StoryObj } from '@storybook/react-vite';
import { withRouter, reactRouterParameters } from 'storybook-addon-remix-react-router';
import { http, HttpResponse } from 'msw';
import { expect, userEvent, within, waitFor } from 'storybook/test';
import OrderSources from './OrderSources';
import type { OrderSource } from '../api/orderSources';

const snapshot = {
  filename: 'synthetic.xlsx', source_sheet: '合成订单', source_row: 2,
  recipient_name: '合成订户', recipient_phone: '00000000000', recipient_address: '合成路1号',
  notes: '合成退款凭证', order_date: '2026-09-01', status_raw: '卖家已退款', paid_amount: '150.00',
  product_lines: [{ raw: '合成运费补拍 X50，单价3', name: '合成运费补拍', quantity: 50, unit_price: '3', is_shipping: true }],
};
const row: OrderSource = {
  id: 1, platform: 'CBJ小程序', store: '', external_order_no: 'SYNTHETIC-SOURCE-1', kind: 'shipping_fee',
  revision: 1, version: 1, order_date: '2026-09-01', commercial_status: 'refunded', paid_amount: '150.00',
  verified_refund_amount: null, verified_refund_date: null, finance_note: null, snapshot, links: [],
  versions: [{ revision: 1, snapshot, created_at: '2026-09-01' }],
};
const meta = {
  title: '页面/营销与交易/来源交易', component: OrderSources, decorators: [withRouter],
  parameters: {
    layout: 'fullscreen', reactRouter: reactRouterParameters({ routing: { path: '/orders/sources' } }),
    msw: { handlers: [
      http.get('/api/order-sources', () => HttpResponse.json({ rows: [row], total: 1 })),
      http.get('/api/order-sources/1', () => HttpResponse.json(row)),
    ] },
  },
} satisfies Meta<typeof OrderSources>;
export default meta;
type Story = StoryObj<typeof meta>;
export const RefundedRecord: Story = {
  name: '退款运费独立留存与原始详情',
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole('button', { name: 'SYNTHETIC-SOURCE-1' }));
    expect(await body.findByText('合成退款凭证')).toBeVisible();
    expect(body.getByText('尚未关联订阅，原始记录已保存。')).toBeVisible();
    expect(body.getByText('原始版本 1')).toBeVisible();
    expect(body.queryByRole('button', { name: '查找或更正关联订阅' })).not.toBeInTheDocument();
  },
};
export const EmptyRecords: Story = {
  name: '待关联空态', parameters: { msw: { handlers: [http.get('/api/order-sources', () => HttpResponse.json({ rows: [], total: 0 }))] } },
  play: async ({ canvasElement }) => { expect(await within(canvasElement).findByText('暂无来源交易')).toBeVisible(); },
};
export const FailedRecords: Story = {
  name: '查询失败可重试', parameters: { msw: { handlers: [http.get('/api/order-sources', () => HttpResponse.json({ detail: 'synthetic' }, { status: 500 }))] } },
  play: async ({ canvasElement }) => { expect(await within(canvasElement).findByText('来源交易加载失败')).toBeVisible(); },
};

const candidate = {
  order_id: 2, order_code: 'SYNTHETIC-SUB', external_order_no: 'SYNTHETIC-SUB', order_date: '2026-01-01',
  order_item_id: 3, target_id: 4, publication: 'cbj', recipient_name: '合成订户', recipient_phone: '00000000000',
  recipient_address: '合成路1号', coverage_start_date: '2026-01-01', coverage_end_date: '2026-12-31',
  confidence: 'possible', evidence: ['姓名一致', '电话一致', '地址一致', '多笔订阅需人工核对'], expected_target_version: 'a'.repeat(64),
};
export const LinkSubscription: Story = {
  name: '管理员核对候选并确认关联',
  parameters: { auth: { isAdmin: true }, msw: { handlers: [
    http.get('/api/order-sources', () => HttpResponse.json({ rows: [row], total: 1 })),
    http.get('/api/order-sources/1', () => HttpResponse.json(row)),
    http.get('/api/order-sources/1/candidates', () => HttpResponse.json({ rows: [candidate], truncated: false })),
    http.post('/api/order-sources/1/link-preview', async ({ request }) => {
      const body = await request.json() as { allocations: { amount: string }[] };
      return Number(body.allocations[0]?.amount) === 150 ? HttpResponse.json({ can_apply: true, total_amount: '150.00', warnings: [] }) : HttpResponse.json({ detail: '分配金额合计必须等于原始付款金额' }, { status: 422 });
    }),
    http.put('/api/order-sources/1/links', async ({ request }) => {
      const body = await request.json();
      expect(body).toMatchObject({ version: 1, reason: '已核对合成收件资料', allocations: [{ order_id: 2, target_id: 4, amount: '150.00' }] });
      return HttpResponse.json({ ...row, version: 2 });
    }),
  ] } },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole('button', { name: 'SYNTHETIC-SOURCE-1' }));
    await userEvent.click(await body.findByRole('button', { name: '查找或更正关联订阅' }));
    await waitFor(() => expect(body.getByText('疑似关联')).toBeVisible());
    await userEvent.click(body.getByRole('checkbox'));
    await userEvent.type(body.getByRole('textbox', { name: '关联原因' }), '已核对合成收件资料');
    await userEvent.click(body.getByRole('button', { name: '预览关联' }));
    await userEvent.click(await body.findByRole('button', { name: '确认保存关联' }));
    await waitFor(() => expect(body.getByText('关联已保存，投递安排需另行确认')).toBeVisible());
  },
};
