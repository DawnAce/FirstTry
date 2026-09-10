import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import OrderImport from './OrderImport';
import type { CoverageCandidate, CoverageChange } from '../api/orderCoverage';

const candidate: CoverageCandidate = {
  key: 'SYNTHETIC-IMPORT#0', order_id: null, external_order_no: 'SYNTHETIC-IMPORT', order_date: '2026-02-01',
  source_platform: 'CBJ小程序', recipient_name: '合成测试订户', publication: 'cbj', subscription_term: 'one_year',
  delivery_method: 'post_office', coverage_start_date: null, coverage_end_date: null, version: 'import-version', blocked_reason: null,
};
let changes: CoverageChange[] = [];
let applied = false;
const parsed = fn();

const meta = {
  title: '页面/营销与交易/电商订单导入', component: OrderImport,
  parameters: {
    layout: 'fullscreen',
    auth: { user: { id: 1, username: 'synthetic-admin', role: 'admin' }, isAdmin: true, canMutate: true, isLoggedIn: true, setAuth: fn(), logout: fn() },
    msw: { handlers: [
      http.post('/api/order-import/preview', () => {
        parsed();
        return HttpResponse.json({ session_id: 'synthetic-session', counts: { import: 1 }, can_commit: true, rows: [{
          external_order_no: candidate.external_order_no, recipient_name: candidate.recipient_name, paid_amount: '199.00',
          status_raw: '卖家已发货', commercial_status: 'shipped', decision: 'import', reason: null, status_unknown: false,
          delivery_overridden_to_zto: false, warnings: [], unresolved_product: null,
          items: [{ ...candidate, fulfillment_type: 'subscription', billing_type: 'paid', total_quantity: 1, unit_price: '199.00', subtotal: '199.00', issue_label: null, issue_number: null }],
        }] });
      }),
      http.get('/api/order-coverage/candidates', ({ request }) => {
        const params = new URL(request.url).searchParams;
        if (!params.has('import_session_id')) expect(params.getAll('order_ids')).toEqual(['777']);
        return HttpResponse.json({ rows: applied ? [] : [candidate], total: applied ? 0 : 1, order_count: applied ? 0 : 1 });
      }),
      http.post('/api/order-coverage/preview', async ({ request }) => {
        const body = await request.json() as { changes: CoverageChange[]; import_session_id: string };
        expect(body.import_session_id).toBe('synthetic-session');
        changes = body.changes;
        return HttpResponse.json({ preview_id: 'synthetic-fill', can_apply: true, order_count: 1, rows: changes.map(c => ({
          key: c.key, external_order_no: candidate.external_order_no, publication: 'cbj', old_start: null, old_end: null,
          new_start: c.coverage_start_date, new_end: c.coverage_end_date, error: null,
        })) });
      }),
      http.post('/api/order-coverage/apply', () => {
        applied = true;
        return HttpResponse.json({ updated: 1, order_count: 1, changes });
      }),
      http.post('/api/order-import/commit', async ({ request }) => {
        expect(await request.json()).toMatchObject({ session_id: 'synthetic-session' });
        expect(changes[0].coverage_end_date).toBe('2027-02-28');
        return HttpResponse.json({ created: 1, order_ids: [777], skipped_duplicates: 0 });
      }),
    ] },
  },
  beforeEach: () => { changes = []; applied = false; parsed.mockClear(); },
} satisfies Meta<typeof OrderImport>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FillBeforeImport: Story = {
  name: '补订期后保留预览并确认导入',
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(body.getByText('历史归档（只补记录）'));
    const upload = canvasElement.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(upload, new File(['synthetic fixture'], 'synthetic.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    await userEvent.click(body.getByRole('button', { name: /预览导入/ }));
    await userEvent.click(await body.findByRole('button', { name: '批量补订期' }));
    await userEvent.click(await body.findByRole('checkbox', { name: '选择明细 SYNTHETIC-IMPORT#0' }));
    await userEvent.type(body.getByLabelText('批量起始月份'), '2026-03');
    await userEvent.keyboard('{Enter}');
    await userEvent.click(body.getByRole('button', { name: '填入所选明细' }));
    await userEvent.click(body.getByRole('button', { name: '核对修改' }));
    await userEvent.click(await body.findByRole('button', { name: '应用到导入预览' }));
    await body.findByText('当前筛选 0 单、0 条明细');
    await userEvent.click(canvasElement.ownerDocument.querySelector('.ant-drawer-close') as HTMLElement);
    await userEvent.click(body.getByRole('button', { name: /预览导入/ }));
    await userEvent.click(await body.findByRole('button', { name: '保留当前预览' }));
    await expect(parsed).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(body.getByText(/覆盖2026-03-01/)).toBeVisible());
    await userEvent.click(body.getByRole('button', { name: '确认导入 1 单' }));
    await userEvent.click(await body.findByRole('button', { name: '继续补本次订期' }));
    await expect(await body.findByText('当前筛选 0 单、0 条明细')).toBeVisible();
  },
};

const promoAlias = '《中国经营报》全年订阅-合成开学季促销';
const existingPromo = {
  id: 7, code: 'CBJ-1Y-PROMO', display_name: '中国经营报 · 全年订阅 · 促销价', aliases: ['合成旧活动'],
  publication: 'cbj', fulfillment_type: 'subscription', subscription_term: 'one_year', delivery_method: 'post_office',
  list_price: '240.00', is_bundle: false, active: true,
};
let aliasLinked = false;
const createdProduct = fn();
const aliasHandlers = [
  http.get('/api/products', () => HttpResponse.json([existingPromo])),
  http.post('/api/products', () => { createdProduct(); return HttpResponse.json({}, { status: 500 }); }),
  http.post('/api/products/7/aliases', async ({ request }) => {
    expect(await request.json()).toEqual({ alias: promoAlias });
    aliasLinked = true;
    return HttpResponse.json({ ...existingPromo, aliases: [...existingPromo.aliases, promoAlias] });
  }),
  http.post('/api/order-import/preview', () => HttpResponse.json({
    session_id: 'synthetic-alias-session', can_commit: aliasLinked,
    counts: { total: 19, import: aliasLinked ? 17 : 0, unresolved: aliasLinked ? 2 : 19 },
    rows: Array.from({ length: 19 }, (_, index) => ({
      external_order_no: `SYNTHETIC-ALIAS-${index}`, recipient_name: '合成测试订户', paid_amount: index < 17 ? '199.00' : '5.00',
      status_raw: '卖家已发货', commercial_status: 'shipped', decision: index < 17 && aliasLinked ? 'import' : 'unresolved',
      reason: index < 17 ? null : '纯运费单需核对', status_unknown: false, delivery_overridden_to_zto: false, warnings: [],
      unresolved_product: index < 17 && !aliasLinked ? promoAlias : null,
      items: index < 17 && aliasLinked ? [{ ...candidate, fulfillment_type: 'subscription', billing_type: 'paid', total_quantity: 1, unit_price: '199.00', subtotal: '199.00', issue_label: null, issue_number: null }] : [],
    })),
  })),
];

async function previewSyntheticAliasFile(canvasElement: HTMLElement) {
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.click(body.getByText('历史归档（只补记录）'));
  await userEvent.upload(canvasElement.querySelector('input[type="file"]') as HTMLInputElement, new File(['synthetic'], 'synthetic.xlsx'));
  await userEvent.click(body.getByRole('button', { name: /预览导入/ }));
  await body.findByText('⚠ 待确认商品（1 种，涉及 17 单）');
  return body;
}

export const LinkExistingPromo: Story = {
  name: '17单促销关联已有商品',
  parameters: { msw: { handlers: aliasHandlers } },
  beforeEach: () => { aliasLinked = false; createdProduct.mockClear(); },
  play: async ({ canvasElement }) => {
    const body = await previewSyntheticAliasFile(canvasElement);
    await userEvent.click(body.getByRole('button', { name: '关联已有商品' }));
    await userEvent.click(await body.findByRole('combobox', { name: '选择已有商品' }));
    await userEvent.click(await body.findByText(`${existingPromo.display_name}（${existingPromo.code}）`, { selector: '.ant-select-item-option-content' }));
    await userEvent.click(body.getByRole('button', { name: '保存别名并重新识别' }));
    await expect(await body.findByRole('button', { name: '确认导入 17 单' })).toBeEnabled();
    await expect(body.getByText('待确认 2')).toBeVisible();
    await expect(createdProduct).not.toHaveBeenCalled();
  },
};

export const ViewerCannotLink: Story = {
  name: '只读账号不可关联商品',
  parameters: { auth: { user: { id: 2, username: 'synthetic-viewer', role: 'viewer' }, isAdmin: false, canMutate: false, isLoggedIn: true }, msw: { handlers: aliasHandlers } },
  beforeEach: () => { aliasLinked = false; },
  play: async ({ canvasElement }) => {
    const body = await previewSyntheticAliasFile(canvasElement);
    await expect(body.queryByRole('button', { name: '关联已有商品' })).not.toBeInTheDocument();
    await expect(body.queryByRole('button', { name: /新增商品/ })).not.toBeInTheDocument();
  },
};
