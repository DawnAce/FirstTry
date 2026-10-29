import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import OrderSourceLinkEditor from './OrderSourceLinkEditor';
import OrderImportFeeEditor from './OrderImportFeeEditor';
import type { OrderSource, SourceLinkPayload } from '../api/orderSources';
import type { ImportFeeAllocation, ImportPreviewRow } from '../api/orderImport';

const closed = fn();
const applied = fn();
const saved = fn();
const snapshot = { recipient_name: '合成订户', recipient_phone: '00000000000', recipient_address: '合成测试路',
  notes: '', order_date: '2099-01-01', status_raw: '卖家已发货', paid_amount: '30.00', product_lines: [] };
const source: OrderSource = { id: 51, external_order_no: 'SYNTHETIC-FEE', platform: '微信小程序', store: '', kind: 'shipping_fee',
  revision: 1, version: 1, order_date: '2099-01-01', commercial_status: 'shipped', paid_amount: '30.00',
  verified_refund_amount: null, verified_refund_date: null, finance_note: null, snapshot, links: [], versions: [] };
const importRow: ImportPreviewRow = { external_order_no: 'SYNTHETIC-FEE', recipient_name: '合成订户', paid_amount: '30.00',
  status_raw: '卖家已发货', commercial_status: 'shipped', decision: 'retain', reason: null, status_unknown: false,
  delivery_overridden_to_zto: false, warnings: [], items: [], unresolved_product: null, is_shipping_fee: true };
const options = { full_period_issue: 9001, full_period_available: true,
  issues: [{ issue_number: 9001, publish_date: '2099-01-02' }, { issue_number: 9002, publish_date: '2099-01-09' }] };
const candidate = { order_id: 2, order_item_id: 3, target_id: 4, order_code: 'SYNTHETIC-SUB', external_order_no: 'SYNTHETIC-SUB',
  order_date: '2098-12-01', publication: 'cbj', recipient_name: '合成订户', recipient_phone: '00000000000',
  recipient_address: '合成测试路', coverage_start_date: '2099-01-01', coverage_end_date: '2099-12-31',
  confidence: 'high', evidence: ['合成候选收件资料一致'], expected_target_version: 'a'.repeat(64), delivery_options: options };
function review(allocations: ImportFeeAllocation[]) {
  return { allocations: allocations.map(value => ({ ...value, delivery: { ...value.delivery, expected_state: 'd'.repeat(64) } })),
    delivery_previews: allocations.map(value => ({ draft_key: value.draft_key, target_id: 4, order_id: 2, recipient_name: '合成订户',
      expected_state: 'd'.repeat(64), from_channel: 'post_office', to_channel: 'zto_outsource',
      effective_date: value.delivery?.scope === 'full_period' ? '2099-01-02' : '2099-01-09',
      postal_until_date: value.delivery?.scope === 'full_period' ? '2099-01-01' : '2099-01-08', postal_records: [], warnings: [] })) };
}
function Editors({ mode }: { mode: 'source' | 'import' }) {
  return mode === 'source' ? <OrderSourceLinkEditor source={source} onClose={closed} />
    : <OrderImportFeeEditor row={importRow} sessionId="synthetic-delivery" version={1} disabled={false} onApplied={applied} onClose={closed} />;
}
const meta = {
  title: '页面/营销与交易/运费与投递范围', component: Editors, args: { mode: 'source' },
  parameters: { layout: 'fullscreen', msw: { handlers: [
    http.get('/api/order-sources/51/candidates', () => HttpResponse.json({ rows: [candidate], truncated: false })),
    http.post('/api/order-sources/51/link-preview', async ({ request }) => {
      const body = await request.json() as SourceLinkPayload;
      return HttpResponse.json({ can_apply: true, total_amount: '30.00', warnings: [], ...review(body.allocations) });
    }),
    http.put('/api/order-sources/51/links', async ({ request }) => { saved(await request.json()); return HttpResponse.json(source); }),
    http.get('/api/order-import/sessions/synthetic-delivery/fee-candidates', () => HttpResponse.json({
      rows: [{ ...candidate, draft_key: 'SYNTHETIC-SUB#0' }], truncated: false, allocations: [] })),
    http.post('/api/order-import/sessions/synthetic-delivery/fee-links/preview', async ({ request }) => {
      const body = await request.json() as { allocations: ImportFeeAllocation[] }; return HttpResponse.json(review(body.allocations));
    }),
    http.post('/api/order-import/sessions/synthetic-delivery/fee-links', async ({ request }) => {
      saved(await request.json()); return HttpResponse.json({ session_id: 'synthetic-delivery', version: 2, rows: [importRow], can_commit: true, counts: { retain: 1 } });
    }),
  ] } },
  beforeEach: () => { closed.mockClear(); applied.mockClear(); saved.mockClear(); },
} satisfies Meta<typeof Editors>;
export default meta;
type Story = StoryObj<typeof meta>;

async function choose(canvasElement: HTMLElement, importing = false) {
  const body = within(canvasElement.ownerDocument.body);
  await body.findByText('合成候选收件资料一致');
  await userEvent.click(body.getByRole('checkbox'));
  await userEvent.type(body.getByRole('textbox', { name: importing ? '运费关联依据' : '关联原因' }), '合成投递范围已核对');
  return body;
}
const confirmLabel = '已核对投递范围及邮局实际安排';
export const FullPeriod: Story = {
  name: '全订期中通与运费一次确认',
  play: async ({ canvasElement }) => {
    const body = await choose(canvasElement);
    await expect(body.getByRole('radio', { name: '整个订期走中通' })).toBeChecked();
    await expect(body.getByRole('button', { name: '预览关联' })).toBeDisabled();
    await userEvent.click(body.getByRole('checkbox', { name: confirmLabel }));
    await userEvent.click(body.getByRole('button', { name: '预览关联' }));
    await userEvent.click(await body.findByRole('button', { name: '确认保存关联' }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith(expect.objectContaining({ allocations: [expect.objectContaining({
      delivery: expect.objectContaining({ scope: 'full_period', postal_confirmed: true, expected_state: 'd'.repeat(64) }) })] })));
  },
};
export const MiddlePeriod: Story = {
  name: '中途转中通必须补齐起始期且修改后重新预览',
  play: async ({ canvasElement }) => {
    const body = await choose(canvasElement);
    await userEvent.click(body.getByRole('radio', { name: '中途改走中通' }));
    await userEvent.click(body.getByRole('checkbox', { name: confirmLabel }));
    await expect(body.getByRole('button', { name: '预览关联' })).toBeDisabled();
    await userEvent.click(body.getByRole('combobox', { name: '中通起始期号' }));
    await userEvent.click(await body.findByText('第 9002 期 · 2099-01-09'));
    await expect(body.getByRole('checkbox', { name: confirmLabel })).not.toBeChecked();
    await userEvent.click(body.getByRole('checkbox', { name: confirmLabel }));
    await userEvent.click(body.getByRole('button', { name: '预览关联' }));
    await expect(await body.findByRole('button', { name: '确认保存关联' })).toBeVisible();
    await waitFor(() => expect(body.getByRole('button', { name: /预览关联/ })).toBeEnabled());
    await userEvent.click(body.getByRole('combobox', { name: '中通起始期号' }));
    await userEvent.click(await body.findByText('第 9001 期 · 2099-01-02'));
    await expect(body.queryByRole('button', { name: '确认保存关联' })).not.toBeInTheDocument();
    await expect(body.getByRole('checkbox', { name: confirmLabel })).not.toBeChecked();
    await expect(body.getByRole('button', { name: /预览关联/ })).toBeDisabled();
  },
};
export const ImportFullPeriod: Story = {
  name: '导入草稿同时核对全订期中通', args: { mode: 'import' },
  play: async ({ canvasElement }) => {
    const body = await choose(canvasElement, true);
    await expect(body.getByRole('button', { name: '确认关联到导入草稿' })).toBeDisabled();
    await userEvent.click(body.getByRole('checkbox', { name: confirmLabel }));
    await userEvent.click(body.getByRole('button', { name: '预览关联与投递' }));
    await waitFor(() => expect(body.getByRole('button', { name: '确认关联到导入草稿' })).toBeEnabled());
    await userEvent.click(body.getByRole('button', { name: '确认关联到导入草稿' }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith(expect.objectContaining({ allocations: [expect.objectContaining({
      draft_key: 'SYNTHETIC-SUB#0', delivery: expect.objectContaining({ scope: 'full_period', expected_state: 'd'.repeat(64) }) })] })));
    await expect(applied).toHaveBeenCalled();
  },
};
export const ImportMiddlePeriod: Story = {
  name: '已开始订期在导入草稿选择中途转投', args: { mode: 'import' },
  parameters: { msw: { handlers: [http.get('/api/order-import/sessions/synthetic-delivery/fee-candidates', () => HttpResponse.json({
    rows: [{ ...candidate, draft_key: 'SYNTHETIC-SUB#0', delivery_options: { ...options, full_period_available: false } }], truncated: false, allocations: [] })),
    ...meta.parameters.msw.handlers.filter(handler => !handler.info.header.includes('fee-candidates'))] } },
  play: async ({ canvasElement }) => {
    const body = await choose(canvasElement, true);
    await expect(body.getByRole('radio', { name: '整个订期走中通' })).toBeDisabled();
    await expect(body.getByRole('radio', { name: '中途改走中通' })).toBeChecked();
    await userEvent.click(body.getByRole('combobox', { name: '中通起始期号' }));
    await userEvent.click(await body.findByText('第 9002 期 · 2099-01-09'));
    await userEvent.click(body.getByRole('checkbox', { name: confirmLabel }));
    await userEvent.click(body.getByRole('button', { name: '预览关联与投递' }));
    await waitFor(() => expect(body.getByRole('button', { name: '确认关联到导入草稿' })).toBeEnabled());
    await userEvent.click(body.getByRole('button', { name: '确认关联到导入草稿' }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith(expect.objectContaining({ allocations: [expect.objectContaining({
      delivery: expect.objectContaining({ scope: 'from_issue', effective_from_issue: 9002 }) })] })));
  },
};
export const DarkCompact: Story = { ...FullPeriod, name: '暗色紧凑全订期确认', globals: { theme: 'dark', density: 'compact' } };
