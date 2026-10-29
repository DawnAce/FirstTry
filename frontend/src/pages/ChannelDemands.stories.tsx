import type { Meta, StoryObj } from '@storybook/react-vite';
import { withRouter, reactRouterParameters } from 'storybook-addon-remix-react-router';
import { http, HttpResponse } from 'msw';
import { expect, userEvent, within, waitFor } from 'storybook/test';
import ChannelDemands from './ChannelDemands';
import type { Demand, DemandOptions } from '../api/channelDemands';

const options: DemandOptions = {
  partners: [{ id: 7, name: '合成机构正式主体', display_name: '合成机构', category: 'chengdu', cycle: 'month', document_type: 'order', transport: 'zto', chengdu: true }],
  contracts: [], templates: [{ category: 'chengdu', sub_category: '成都杂志铺', display_name: '成都杂志铺' }],
};
const draft: Demand = {
  id: 101, partner_id: 7, partner_name: '合成机构正式主体', display_name: '合成机构', category: 'chengdu', contract_id: null,
  document_type: 'order', cycle: 'month', received_date: '2026-10-16', transport: 'zto', status: 'draft', version: 1,
  supersedes_id: null, confirmed_at: null, pricing: null, attachments: [], notes: '合成需求，供交互验收',
  lines: [
    { id: 1, issue_number: 2680, publish_date: '2026-11-02', sub_category: '成都杂志铺', quantity: 100, review_status: 'confirmed', unit_price: null },
    { id: 2, issue_number: 2681, publish_date: '2026-11-09', sub_category: '成都杂志铺', quantity: null, review_status: 'pending', unit_price: null },
  ],
};
const handlers = [
  http.get('/api/channel-demands/options', () => HttpResponse.json(options)),
  http.get('/api/channel-demands', () => HttpResponse.json({ total: 1, items: [draft] })),
  http.get('/api/channel-demands/101', () => HttpResponse.json(draft)),
  http.get('/api/channel-demands/101/trace', () => HttpResponse.json(draft.lines.map(l => ({ line_id: l.id, issue_number: l.issue_number, sub_category: l.sub_category, issue_id: null, print_status: 'not_created', adopted_quantity: null, adopted_version: null })))),
  http.get('/api/schedule', () => HttpResponse.json(draft.lines.map((l, i) => ({ id: i + 1, year: 2026, issue_number: l.issue_number, publish_date: l.publish_date, is_suspended: false })))),
  http.post('/api/channel-demands/101/confirm', async ({ request }) => {
    expect(await request.json()).toEqual({ version: 1, reviewed: true });
    return HttpResponse.json({ ...draft, status: 'confirmed', confirmed_at: '2026-10-16T16:00:00' });
  }),
];
const meta = {
  title: '页面/营销与交易/机构渠道需求', component: ChannelDemands, decorators: [withRouter],
  parameters: { layout: 'fullscreen', auth: { canMutate: true, isAdmin: true, isViewer: false },
    reactRouter: reactRouterParameters({ routing: { path: '/orders/channel-demands' } }), msw: { handlers } },
} satisfies Meta<typeof ChannelDemands>;
export default meta;
type Story = StoryObj<typeof meta>;
export const List: Story = {
  name: '需求列表与待定状态',
  play: async ({ canvasElement }) => { const canvas = within(canvasElement); expect(await canvas.findByText('需求 #101')).toBeVisible(); expect(await canvas.findByText('1项待确认')).toBeVisible(); },
};
export const Empty: Story = {
  name: '无需求空态', parameters: { msw: { handlers: [http.get('/api/channel-demands', () => HttpResponse.json({ total: 0, items: [] })), ...handlers.slice(0, 1)] } },
  play: async ({ canvasElement }) => { expect(await within(canvasElement).findByText('暂无机构需求')).toBeVisible(); },
};
export const Failed: Story = {
  name: '加载失败可重试', parameters: { msw: { handlers: [http.get('/api/channel-demands', () => HttpResponse.json({ detail: '合成查询失败' }, { status: 503 })), ...handlers.slice(0, 1)] } },
  play: async ({ canvasElement }) => { expect(await within(canvasElement).findByText('需求列表未能加载')).toBeVisible(); },
};
export const ReviewDraft: Story = {
  name: '关闭预览不能绕过人工核对',
  parameters: { reactRouter: reactRouterParameters({ location: { pathParams: { id: '101' } }, routing: { path: '/orders/channel-demands/:id' } }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await canvas.findByRole('button', { name: '核对并确认需求' }));
    let dialog = within(await body.findByRole('dialog'));
    expect(dialog.getByRole('button', { name: '确认已核对需求' })).toBeDisabled();
    await userEvent.click(dialog.getByRole('checkbox'));
    expect(dialog.getByRole('button', { name: '确认已核对需求' })).toBeEnabled();
    await userEvent.click(dialog.getByRole('button', { name: '取 消' }));
    await userEvent.click(canvas.getByRole('button', { name: '核对并确认需求' }));
    dialog = within(await body.findByRole('dialog'));
    expect(dialog.getByRole('button', { name: '确认已核对需求' })).toBeDisabled();
    await userEvent.click(dialog.getByRole('checkbox'));
    await userEvent.click(dialog.getByRole('button', { name: '确认已核对需求' }));
    await waitFor(() => expect(canvas.getByText('已确认需求 · v1')).toBeVisible());
    expect(canvas.queryByRole('button', { name: '保存草稿' })).not.toBeInTheDocument();
    expect(canvas.getByRole('button', { name: '创建更正版本' })).toBeVisible();
  },
};
export const DarkCompact: Story = {
  name: '深色紧凑录入与追溯', globals: { theme: 'dark', density: 'compact' },
  parameters: { reactRouter: reactRouterParameters({ location: { pathParams: { id: '101' } }, routing: { path: '/orders/channel-demands/:id' } }) },
  play: async ({ canvasElement }) => { expect(await within(canvasElement).findByText('本单摘要')).toBeVisible(); },
};
export const ReadOnly: Story = {
  name: '只读账号可查不可改',
  parameters: { auth: { canMutate: false, isViewer: true }, reactRouter: reactRouterParameters({ location: { pathParams: { id: '101' } }, routing: { path: '/orders/channel-demands/:id' } }) },
  play: async ({ canvasElement }) => { const canvas = within(canvasElement); await canvas.findByText('本单摘要'); expect(canvas.queryByRole('button', { name: '保存草稿' })).not.toBeInTheDocument(); expect(canvas.getByLabelText('第2680期成都杂志铺数量')).toBeDisabled(); },
};
export const LockedPastFuturePending: Story = {
  name: '月报已锁定前期仍可核定未来期',
  parameters: {
    reactRouter: reactRouterParameters({ location: { pathParams: { id: '101' } }, routing: { path: '/orders/channel-demands/:id' } }),
    msw: { handlers: [http.get('/api/channel-demands/101/trace', () => HttpResponse.json([
      { line_id: 1, issue_number: 2680, sub_category: '成都杂志铺', issue_id: 1, print_status: 'confirmed', adopted_quantity: 100, adopted_version: 1, adopted_demand_id: 100 },
      { line_id: 2, issue_number: 2681, sub_category: '成都杂志铺', issue_id: null, print_status: 'not_created', adopted_quantity: null, adopted_version: null, adopted_demand_id: null },
    ])), ...handlers.filter((_, index) => index !== 3)] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText('#100');
    expect(canvas.getByLabelText('第2680期成都杂志铺数量')).toBeDisabled();
    expect(canvas.getByLabelText('第2681期成都杂志铺数量')).toBeEnabled();
  },
};
