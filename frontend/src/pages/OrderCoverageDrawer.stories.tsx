import type { Meta, StoryObj } from '@storybook/react-vite';
import { delay, http, HttpResponse } from 'msw';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import OrderCoverageDrawer from './OrderCoverageDrawer';
import type { CoverageCandidate, CoverageChange } from '../api/orderCoverage';

const rows: CoverageCandidate[] = [
  { key: '11', order_id: 1, external_order_no: 'SYNTHETIC-001', order_date: '2026-02-01', source_platform: 'CBJ小程序', recipient_name: '测试订户甲', publication: 'cbj', subscription_term: 'one_year', delivery_method: 'post_office', coverage_start_date: null, coverage_end_date: null, version: 'first-version', blocked_reason: null },
  { key: '12', order_id: 1, external_order_no: 'SYNTHETIC-001', order_date: '2026-02-01', source_platform: 'CBJ小程序', recipient_name: '测试订户甲', publication: 'business_school', subscription_term: 'half_year', delivery_method: 'zto_mf', coverage_start_date: null, coverage_end_date: null, version: 'second-version', blocked_reason: null },
  { key: '13', order_id: 2, external_order_no: 'SYNTHETIC-002', order_date: '2026-02-20', source_platform: 'CBJ小程序', recipient_name: '测试退款订户', publication: 'cbj', subscription_term: 'one_year', delivery_method: 'post_office', coverage_start_date: null, coverage_end_date: null, version: 'refund-version', blocked_reason: '退款、取消或待付款订单，请在订单详情单独核对' },
];

const meta = {
  title: '页面/营销与交易/批量补订期', component: OrderCoverageDrawer,
  args: { onClose: fn(), onApplied: fn() },
  parameters: { layout: 'fullscreen', msw: { handlers: [
    http.get('/api/order-coverage/candidates', ({ request }) => {
      const publication = new URL(request.url).searchParams.get('publication');
      const filtered = rows.filter(r => !publication || r.publication === publication);
      return HttpResponse.json({ rows: filtered, total: filtered.length, order_count: new Set(filtered.map(r => r.order_id)).size });
    }),
  ] } },
} satisfies Meta<typeof OrderCoverageDrawer>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {
  name: '双刊分行与退款提示',
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByText('当前筛选 2 单、3 条明细')).toBeVisible();
    await expect(body.getByRole('checkbox', { name: '选择明细 13' })).toBeDisabled();
    await expect(body.getByRole('button', { name: '核对修改' })).toBeDisabled();
  },
};

export const CompleteFlow: Story = {
  name: '全年半年批量填写预览保存',
  parameters: { msw: { handlers: [
    http.get('/api/order-coverage/candidates', () => HttpResponse.json({ rows, total: 3, order_count: 2 })),
    http.post('/api/order-coverage/preview', async ({ request }) => {
      const body = await request.json() as { changes: CoverageChange[] };
      await expect(body.changes).toHaveLength(2);
      await expect(body.changes.find(c => c.key === '11')?.coverage_end_date).toBe('2027-02-28');
      await expect(body.changes.find(c => c.key === '12')?.coverage_end_date).toBe('2026-08-31');
      return HttpResponse.json({ preview_id: 'coverage-preview', can_apply: true, order_count: 1,
        rows: body.changes.map(c => ({ key: c.key, external_order_no: 'SYNTHETIC-001', publication: c.key === '11' ? 'cbj' : 'business_school', old_start: null, old_end: null, new_start: c.coverage_start_date, new_end: c.coverage_end_date, error: null })) });
    }),
    http.post('/api/order-coverage/apply', () => HttpResponse.json({ updated: 2, order_count: 1, changes: [] })),
  ] } },
  play: async ({ canvasElement, args }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByText('当前筛选 2 单、3 条明细')).toBeVisible();
    await userEvent.click(body.getByRole('checkbox', { name: '选择明细 11' }));
    await userEvent.click(body.getByRole('checkbox', { name: '选择明细 12' }));
    const month = body.getByLabelText('批量起始月份');
    await userEvent.click(month);
    await userEvent.type(month, '2026-03');
    await userEvent.keyboard('{Enter}');
    await userEvent.click(body.getByRole('button', { name: '填入所选明细' }));
    await expect(body.getByLabelText('11 结束日期')).toHaveValue('2027-02-28');
    await expect(body.getByLabelText('12 结束日期')).toHaveValue('2026-08-31');
    await userEvent.click(body.getByRole('button', { name: '核对修改' }));
    await userEvent.click(await body.findByRole('button', { name: '确认保存订期' }));
    await waitFor(() => expect(args.onApplied).toHaveBeenCalledWith({ updated: 2, order_count: 1, changes: [] }));
  },
};

export const DarkCompact: Story = { ...Loaded, name: '暗色紧凑', globals: { theme: 'dark', density: 'compact' } };

export const CrossPageSelection: Story = {
  name: '跨页选择保留原版本',
  parameters: { msw: { handlers: [
    http.get('/api/order-coverage/candidates', ({ request }) => {
      const params = new URL(request.url).searchParams;
      const skip = Number(params.get('skip') || 0);
      const all = Array.from({ length: 51 }, (_, index) => ({ ...rows[0], key: String(index + 100), order_id: index + 100,
        external_order_no: `SYNTHETIC-PAGE-${index}`, version: params.has('publication') ? 'refreshed-version' : 'original-version' }));
      return HttpResponse.json({ rows: all.slice(skip, skip + 50), total: 51, order_count: 51 });
    }),
    http.post('/api/order-coverage/preview', async ({ request }) => {
      const body = await request.json() as { changes: CoverageChange[] };
      await expect(body.changes.map(c => c.key).sort()).toEqual(['100', '101', '150']);
      await expect(body.changes.find(c => c.key === '100')?.expected_version).toBe('original-version');
      return HttpResponse.json({ preview_id: null, can_apply: false, order_count: 3,
        rows: body.changes.map(c => ({ key: c.key, external_order_no: c.key, publication: 'cbj', old_start: null, old_end: null,
          new_start: c.coverage_start_date, new_end: c.coverage_end_date, error: '订单或明细已变更，请刷新后重新预览' })) });
    }),
  ] } },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole('checkbox', { name: '选择明细 100' }));
    await userEvent.click(body.getByTitle('2'));
    await userEvent.click(await body.findByRole('checkbox', { name: '选择明细 150' }));
    // 切换筛选会重新读取第一页；此前的选择仍必须携带旧版本。
    await userEvent.click(body.getByRole('combobox', { name: '刊物筛选' }));
    await userEvent.click(await body.findByText('中国经营报', { selector: '.ant-select-item-option-content' }));
    await userEvent.click(await body.findByRole('checkbox', { name: '选择明细 101' }));
    const month = body.getByLabelText('批量起始月份');
    await userEvent.type(month, '2026-03');
    await userEvent.keyboard('{Enter}');
    await userEvent.click(body.getByRole('button', { name: '填入所选明细' }));
    await userEvent.click(body.getByRole('button', { name: '核对修改' }));
    await expect(await body.findByRole('button', { name: '确认保存订期' })).toBeDisabled();
    await waitFor(() => expect(body.getByText('存在未通过校验的明细，请返回修改或取消选择后重新预览。')).toBeVisible());
  },
};

export const EmptyState: Story = { name: '全部补齐', parameters: { msw: { handlers: [http.get('/api/order-coverage/candidates', () => HttpResponse.json({ rows: [], total: 0, order_count: 0 }))] } } };
export const ErrorState: Story = {
  name: '读取失败可重试',
  parameters: { msw: { handlers: [http.get('/api/order-coverage/candidates', () => HttpResponse.json({ detail: '导入会话已过期，请重新预览 Excel' }, { status: 400 }))] } },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByText('导入会话已过期，请重新预览 Excel')).toBeVisible();
    await expect(body.getByRole('button', { name: /重\s*试/ })).toBeEnabled();
  },
};
export const Loading: Story = { name: '加载中', parameters: { msw: { handlers: [http.get('/api/order-coverage/candidates', async () => { await delay('infinite'); return HttpResponse.json({}); })] } } };
