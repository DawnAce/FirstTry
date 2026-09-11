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

export const ImportFollowUp: Story = {
  name: '导入后的运费入口直接打开关联窗口',
  parameters: { ...LinkSubscription.parameters,
    reactRouter: reactRouterParameters({ routing: { path: '/orders/sources' }, location: { searchParams: { source: '1', action: 'link' } } }),
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(body.getByRole('textbox', { name: '关联原因' })).toBeVisible());
    await body.findByText('疑似关联');
    await userEvent.click(body.getByRole('checkbox'));
    await expect(body.getByRole('button', { name: '预览关联' })).toBeVisible();
  },
};

export const ReadOnlyImportFollowUp: Story = {
  name: '只读账号不能从运费链接进入编辑',
  parameters: { ...ImportFollowUp.parameters, auth: { isAdmin: false } },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(body.getByText('尚未关联订阅，原始记录已保存。')).toBeVisible());
    await expect(body.queryByRole('textbox', { name: '关联原因' })).not.toBeInTheDocument();
  },
};

export const VerifyFeeRefund: Story = {
  name: '核对全额运费退款并保留订阅',
  parameters: { auth: { isAdmin: true }, msw: { handlers: [
    http.get('/api/order-sources', () => HttpResponse.json({ rows: [row], total: 1 })),
    http.get('/api/order-sources/1', () => HttpResponse.json({ ...row, refund_pending: true })),
    http.post('/api/order-sources/1/refund-preview', () => HttpResponse.json(row)),
    http.put('/api/order-sources/1/refund', async ({ request }) => {
      expect(await request.json()).toMatchObject({ version: 1, amount: '150', refunded_at: '2026-09-01', reason: '合成退款凭据' });
      return HttpResponse.json({ ...row, version: 2 });
    }),
  ] } },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole('button', { name: 'SYNTHETIC-SOURCE-1' }));
    await userEvent.click(await body.findByRole('button', { name: '核对或更正运费退款' }));
    const input = await body.findByRole('spinbutton', { name: '累计退款金额' });
    await waitFor(() => expect(input).toBeVisible());
    await userEvent.clear(input); await userEvent.type(input, '150', { delay: 50 });
    await userEvent.tab();
    await waitFor(() => expect(input).toHaveValue('150.00'));
    const date = body.getByRole('textbox', { name: '实际退款日期' });
    await userEvent.click(date); await userEvent.type(date, '2026-09-01{Enter}');
    await userEvent.type(body.getByRole('textbox', { name: '退款凭据或更正依据' }), '合成退款凭据');
    await userEvent.click(body.getByRole('button', { name: '预览退款核对' }));
    await userEvent.click(await body.findByRole('button', { name: '确认退款核对' }));
    await waitFor(() => expect(body.getByText('运费退款已核对，主订阅状态不变')).toBeVisible());
  },
};
const linkedRow: OrderSource = { ...row, commercial_status: 'shipped', snapshot: { ...snapshot, status_raw: '卖家已发货' },
  links: [{ id: 1, order_id: 2, order_item_id: 3, target_id: 4, active: 1, amount: '150.00', delivery_from_issue: null, reason: '合成关联' }] };
const deliveryHandlers = [
  http.get('/api/order-sources', () => HttpResponse.json({ rows: [linkedRow], total: 1 })),
  http.get('/api/order-sources/1', () => HttpResponse.json(linkedRow)),
  http.get('/api/order-sources/1/delivery-options', () => HttpResponse.json({ target_id: 4, recipient_name: '合成订户', shipping_channel: 'post_office', issues: [{ issue_number: 9001, publish_date: '2099-01-02' }] })),
];
const deliveryPreview = { expected_state: 'd'.repeat(64), effective_date: '2099-01-02', postal_until_date: '2099-01-01', order_id: 2, target_id: 4, recipient_name: '合成订户', from_channel: 'post_office', to_channel: 'zto_outsource',
  postal_records: [{ id: 8, delivery_no: '2099-SYNTHETIC', recipient_name: '合成订户', recipient_phone: '00000000000', recipient_address: '合成路1号', start: '2098-01-01', end: '2099-12-31', required: true, selected: true }],
  warnings: ['请确认邮局实际停投手续，不自动生成发货。'] };
async function openDelivery(canvasElement: HTMLElement) {
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.click(await body.findByRole('button', { name: 'SYNTHETIC-SOURCE-1' }));
  await userEvent.click(await body.findByRole('button', { name: '确认或更正投递' }));
  await userEvent.click(await body.findByRole('combobox', { name: '转投生效刊期' }));
  await userEvent.click(await body.findByText('第 9001 期 · 2099-01-02'));
  await userEvent.type(body.getByRole('textbox', { name: '投递变更依据' }), '合成停投手续已核对');
  await userEvent.click(body.getByRole('button', { name: '预览投递变更' }));
  return body;
}
export const ConfirmDelivery: Story = {
  name: '单独核对刊期及邮局手续后转中通',
  parameters: { auth: { isAdmin: true }, msw: { handlers: [ ...deliveryHandlers,
    http.post('/api/order-sources/1/delivery-preview', () => HttpResponse.json(deliveryPreview)),
    http.post('/api/order-sources/1/delivery', async ({ request }) => {
      expect(await request.json()).toMatchObject({ version: 1, link_id: 1, effective_from_issue: 9001, postal_confirmed: true, expected_state: 'd'.repeat(64) });
      return HttpResponse.json(linkedRow);
    }),
  ] } },
  play: async ({ canvasElement }) => {
    const body = await openDelivery(canvasElement);
    expect(await body.findByRole('button', { name: '确认投递变更' })).toBeDisabled();
    await userEvent.click(body.getByRole('checkbox', { name: '已核对选中邮局记录与实际停投/起投手续，确认生效边界' }));
    await userEvent.click(body.getByRole('button', { name: '确认投递变更' }));
    await waitFor(() => expect(body.getByText('投递安排已更新，历史记录已保留')).toBeVisible());
  },
};
export const DeliveryConflict: Story = {
  name: '已有发货计划时阻止转投',
  parameters: { auth: { isAdmin: true }, msw: { handlers: [...deliveryHandlers,
    http.post('/api/order-sources/1/delivery-preview', () => HttpResponse.json({ detail: '生效范围已有发货计划，请先核对处理' }, { status: 409 })),
  ] } },
  play: async ({ canvasElement }) => {
    const body = await openDelivery(canvasElement);
    await waitFor(() => expect(body.getByText('生效范围已有发货计划，请先核对处理')).toBeVisible());
    expect(body.queryByRole('button', { name: '确认投递变更' })).not.toBeInTheDocument();
  },
};
