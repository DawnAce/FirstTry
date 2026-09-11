import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import OrderImport from './OrderImport';
import type { ImportPreviewOut, ImportPreviewRow } from '../api/orderImport';

const normal: ImportPreviewRow = {
  external_order_no: 'SYNTHETIC-SUB', recipient_name: '合成订户', paid_amount: '120.00', status_raw: '卖家已发货', commercial_status: 'shipped',
  decision: 'import', reason: null, status_unknown: false, delivery_overridden_to_zto: false, warnings: [], unresolved_product: null,
  source_snapshot: { recipient_name: '合成订户', recipient_phone: '', recipient_address: '合成测试地址', order_date: '2026-01-26',
    product_lines: [{ name: '合成邮局半年订阅', is_shipping: false, quantity: 1, unit_price: '120.00' }] },
  reviews: [], money: { paid: '120.00', shipping: '0', excluded: '0', items: '120.00' },
  items: [{ publication: 'cbj', fulfillment_type: 'subscription', billing_type: 'paid', subscription_term: 'half_year', delivery_method: 'post_office',
    issue_label: null, issue_number: null, total_quantity: 1, unit_price: '120.00', subtotal: '120.00', coverage_start_date: '2026-02-01', coverage_end_date: '2026-07-31' }],
};
const transfer: ImportPreviewRow = { ...normal, delivery_overridden_to_zto: true, reviews: [{ id: 'delivery:0', kind: 'delivery', item_index: 0,
  title: '投递方式待核对', reason: '同单运费注明中通，请核对本条明细是否转投', original: 'post_office', suggested: 'zto_mf', value: 'post_office', status: 'pending' }] };
const fee: ImportPreviewRow = { ...normal, external_order_no: 'SYNTHETIC-FEE', paid_amount: '30.00', decision: 'retain', items: [],
  is_shipping_fee: true, fee_link_count: 0, reason: '纯运费记录：仅保存交易，不新增订阅或发货' };
let data: ImportPreviewOut;
let emptyCandidates = false;
let rejectReview = false;
const committed = fn();
const reviewed = fn();
const meta = {
  title: '页面/营销与交易/导入核对与运费关联', component: OrderImport,
  parameters: { layout: 'fullscreen', auth: { user: { id: 1, username: 'synthetic-admin', role: 'admin' }, isAdmin: true, canMutate: true, isLoggedIn: true, setAuth: fn(), logout: fn() },
    msw: { handlers: [
      http.post('/api/order-import/preview', () => HttpResponse.json(data)),
      http.get('/api/order-import/sessions/synthetic-workflow', () => HttpResponse.json(data)),
      http.get('/api/products', () => HttpResponse.json([{ id: 99, display_name: '合成半年商品', code: 'SYNTHETIC-6M' }])),
      http.post('/api/order-import/sessions/synthetic-workflow/review', async ({ request }) => {
        const body = await request.json() as { kind: string; value: string; amounts?: string[]; reason: string; expected_version: number };
        expect(body.expected_version).toBe(data.version);
        expect(body.reason.trim()).not.toBe('');
        reviewed(body);
        if (rejectReview) {
          rejectReview = false; data = { ...data, version: (data.version ?? 1) + 1 };
          return HttpResponse.json({ detail: '导入草稿已变化，请刷新核对内容后重试' }, { status: 409 });
        }
        data = { ...data, version: (data.version ?? 1) + 1, can_commit: true, pending_review_count: 0, rows: [{ ...data.rows[0], delivery_overridden_to_zto: false,
          ...(body.kind === 'status' ? { commercial_status: body.value } : {}),
          ...(body.kind === 'date' ? { order_date: body.value } : {}),
          reviews: data.rows[0].reviews?.map(review => ({ ...review, value: body.value, status: 'confirmed' })),
          items: data.rows[0].items.map((item, index) => ({ ...item,
            ...(body.kind === 'delivery' ? { delivery_method: body.value, coverage_start_date: '2026-03-01' } : {}),
            ...(body.kind === 'amount' ? { subtotal: body.amounts![index] } : {}),
          })) }] };
        return HttpResponse.json(data);
      }),
      http.get('/api/order-import/sessions/synthetic-workflow/fee-candidates', () => HttpResponse.json({ rows: emptyCandidates ? [] : [{
        draft_key: 'SYNTHETIC-SUB#0', order_id: null, order_item_id: null, target_id: null, order_code: null, external_order_no: 'SYNTHETIC-SUB',
        recipient_name: '合成订户', recipient_phone: '', recipient_address: '合成测试地址', publication: 'cbj', order_date: '2026-01-26',
        coverage_start_date: '2026-02-01', coverage_end_date: '2026-07-31', confidence: 'possible', evidence: ['本批待导入订阅', '姓名一致', '电话未填'],
        expected_target_version: 'a'.repeat(64),
      }], truncated: false, allocations: [] })),
      http.post('/api/order-import/sessions/synthetic-workflow/fee-links', async ({ request }) => {
        const body = await request.json() as { allocations: { draft_key: string; amount: string }[]; expected_version: number };
        expect(body.expected_version).toBe(1);
        if (body.allocations.length) expect(body.allocations[0]).toMatchObject({ draft_key: 'SYNTHETIC-SUB#0', amount: '30.00' });
        data = { ...data, version: 2, rows: data.rows.map(row => row.is_shipping_fee ? { ...row, fee_link_count: body.allocations.length } : row) };
        return HttpResponse.json(data);
      }),
      http.post('/api/order-import/commit', async ({ request }) => {
        const body = await request.json() as { expected_version: number };
        expect(body.expected_version).toBe(data.version); committed();
        return HttpResponse.json({ created: 1, order_ids: [701], skipped_duplicates: 0, retained_sources: data.rows.some(row => row.is_shipping_fee) ? 1 : 0,
          fee_sources: data.rows.filter(row => row.is_shipping_fee).map(row => ({ id: 702, external_order_no: row.external_order_no, linked: !!row.fee_link_count })) });
      }),
      http.all('/api/*', () => HttpResponse.json({ detail: '合成测试未配置此接口' }, { status: 501 })),
    ] } },
  beforeEach: () => { committed.mockClear(); reviewed.mockClear(); rejectReview = false; emptyCandidates = false; data = { session_id: 'synthetic-workflow', version: 1, counts: { import: 1 }, can_commit: false, pending_review_count: 1, rows: structuredClone([transfer]) }; },
} satisfies Meta<typeof OrderImport>;
export default meta;
type Story = StoryObj<typeof meta>;

async function upload(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.upload(canvasElement.querySelector('input[type="file"]') as HTMLInputElement, new File(['synthetic'], 'synthetic.xlsx'));
  await userEvent.click(canvas.getByRole('button', { name: /预览导入/ }));
  await canvas.findByText('当前显示 ' + data.rows.length + ' 笔 / 全部 ' + data.rows.length + ' 笔');
}

export const DeliveryReview: Story = {
  name: '投递核对入口与提交阻断',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement); const body = within(canvasElement.ownerDocument.body);
    await upload(canvasElement);
    await expect(canvas.getByRole('button', { name: /确认导入/ })).toBeDisabled();
    await userEvent.click(canvas.getByRole('button', { name: '处理下一条' }));
    await userEvent.click(await body.findByRole('button', { name: '核对并处理' }));
    await userEvent.type(body.getByLabelText('核对依据'), '合成客服记录确认');
    await userEvent.click(body.getByRole('button', { name: '应用并确认核对' }));
    await expect(await body.findByText('已核对')).toBeVisible();
    await userEvent.click(body.getByRole('dialog').querySelector('.ant-modal-close') as HTMLElement);
    await expect(canvas.getByText(/2026-03-01 至/)).toBeVisible();
    await expect(canvas.getByRole('button', { name: /确认导入/ })).toBeEnabled();
    await userEvent.click(canvas.getByRole('button', { name: /预览导入/ }));
    await waitFor(() => expect(body.getByText(/识别核对及运费关联草稿尚未正式入库/)).toBeVisible());
    await userEvent.click(body.getByRole('button', { name: '保留当前预览' }));
    await userEvent.click(canvas.getByRole('button', { name: /确认导入/ }));
    await expect(await canvas.findByText('本次已导入 1 单')).toBeVisible();
    await expect(committed).toHaveBeenCalledTimes(1);
  },
};

export const FeeSameBatch: Story = {
  name: '同批运费选择订阅并衔接转投核对',
  beforeEach: () => { data = { ...data, can_commit: true, pending_review_count: 0, counts: { import: 1, retain: 1 }, rows: structuredClone([normal, fee]) }; },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement); const body = within(canvasElement.ownerDocument.body);
    await upload(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: '查找关联订阅' }));
    await body.findByText('本批待导入');
    await userEvent.click(body.getByRole('dialog').querySelector('tbody input[type="checkbox"]') as HTMLElement);
    await userEvent.type(body.getByLabelText('运费关联依据'), '合成补费记录对应本批订阅');
    await userEvent.click(body.getByRole('button', { name: '确认关联到导入草稿' }));
    await expect(await canvas.findByText('已选 1 个订阅，待导入保存')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: /确认导入/ }));
    await expect(await canvas.findByRole('link', { name: '查看关联并核对投递' })).toHaveAttribute('href', '/orders/sources?source=702');
  },
};

export const FeeDeferred: Story = {
  name: '找不到订阅时留存并保留待关联入口',
  beforeEach: () => { emptyCandidates = true; data = { ...data, can_commit: true, pending_review_count: 0, counts: { import: 1, retain: 1 }, rows: structuredClone([normal, fee]) }; },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement); const body = within(canvasElement.ownerDocument.body);
    await upload(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: '查找关联订阅' }));
    await waitFor(() => expect(body.getByText(/未找到候选，可补充搜索词/)).toBeVisible());
    await userEvent.click(body.getByRole('button', { name: '暂不关联，留存后处理' }));
    await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(canvas.getByRole('button', { name: /确认导入/ }));
    await expect(await canvas.findByRole('link', { name: '继续关联此笔运费' })).toHaveAttribute('href', '/orders/sources?source=702&action=link');
  },
};

export const ReadOnly: Story = {
  name: '普通用户可查看提示但不能修改核对',
  parameters: { auth: { user: { id: 2, username: 'synthetic-viewer', role: 'operator' }, isAdmin: false, canMutate: false, isLoggedIn: true, setAuth: fn(), logout: fn() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await upload(canvasElement);
    await expect(canvas.getByRole('button', { name: '核对／修改识别' })).toBeDisabled();
    await expect(canvas.getByText('确认导入需管理员权限')).toBeVisible();
  },
};

export const AmountCorrection: Story = {
  name: '套餐负金额可更正并恢复提交',
  beforeEach: () => { data.rows = [{ ...structuredClone(normal), paid_amount: '200.00',
    money: { paid: '200.00', shipping: '0', excluded: '0', items: '200.00' },
    reviews: [{ id: 'amount', kind: 'amount', title: '金额分摊待核对', reason: '明细不能为负', status: 'pending' }],
    items: [{ ...normal.items[0], subtotal: '240.00' }, { ...normal.items[0], publication: 'business_school', subtotal: '-40.00' }] }]; },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement); const body = within(canvasElement.ownerDocument.body);
    await upload(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: '处理下一条' }));
    await userEvent.click(await body.findByRole('button', { name: '核对并处理' }));
    const first = body.getByLabelText(/明细 1 ·/); const second = body.getByLabelText(/明细 2 ·/);
    await userEvent.clear(first); await userEvent.type(first, '120.00');
    await userEvent.clear(second); await userEvent.type(second, '80.00');
    await userEvent.type(body.getByLabelText('核对依据'), '合成套餐优惠分摊');
    await userEvent.click(body.getByRole('button', { name: '应用并确认核对' }));
    await body.findByText('已核对');
    await expect(reviewed).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'amount' }));
    await expect(reviewed.mock.lastCall![0].amounts.map(Number)).toEqual([120, 80]);
    await userEvent.click(body.getByRole('dialog').querySelector('.ant-modal-close') as HTMLElement);
    await expect(canvas.getByRole('button', { name: /确认导入/ })).toBeEnabled();
  },
};

export const StatusDateProduct: Story = {
  name: '状态日期和本单商品可分别更正',
  beforeEach: () => { data = { ...data, can_commit: true, pending_review_count: 0, rows: structuredClone([normal]) }; },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement); const body = within(canvasElement.ownerDocument.body);
    await upload(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: '核对／修改识别' }));
    await userEvent.click(await body.findByRole('button', { name: '更正交易状态' }));
    await userEvent.click(within(body.getByRole('dialog')).getByRole('combobox'));
    await userEvent.click(await body.findByText('已付款／待发货'));
    await userEvent.type(body.getByLabelText('核对依据'), '合成状态依据');
    await userEvent.click(body.getByRole('button', { name: '应用并确认核对' }));
    await body.findByRole('button', { name: '补充或更正下单日期' });
    await expect(reviewed).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'status', value: 'paid' }));
    await userEvent.click(body.getByRole('button', { name: '补充或更正下单日期' }));
    await userEvent.clear(body.getByLabelText('下单日期')); await userEvent.type(body.getByLabelText('下单日期'), '2026-01-25');
    await userEvent.type(body.getByLabelText('核对依据'), '合成日期依据');
    await userEvent.click(body.getByRole('button', { name: '应用并确认核对' }));
    await body.findByRole('button', { name: '更正本单商品' });
    await expect(reviewed).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'date', value: '2026-01-25', expected_version: 2 }));
    await userEvent.click(body.getByRole('button', { name: '更正本单商品' }));
    await userEvent.click(body.getByLabelText('原始商品行'));
    await userEvent.click(await body.findByText('合成邮局半年订阅'));
    await userEvent.click(body.getByLabelText('本单应使用的商品'));
    await userEvent.click(await body.findByText('合成半年商品 · SYNTHETIC-6M'));
    await userEvent.type(body.getByLabelText('核对依据'), '合成商品依据');
    await userEvent.click(body.getByRole('button', { name: '应用并确认核对' }));
    await body.findByRole('button', { name: '更正本单商品' });
    await expect(reviewed).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'product', product_id: 99, item_index: 0, expected_version: 3 }));
  },
};

export const StaleDraftRecovery: Story = {
  name: '过期草稿提示可刷新并重新核对',
  beforeEach: () => { rejectReview = true; },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement); const body = within(canvasElement.ownerDocument.body);
    await upload(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: '处理下一条' }));
    await userEvent.click(await body.findByRole('button', { name: '核对并处理' }));
    await userEvent.type(body.getByLabelText('核对依据'), '合成原始依据');
    await userEvent.click(body.getByRole('button', { name: '应用并确认核对' }));
    await expect(await body.findByText('导入草稿已变化，请刷新核对内容后重试')).toBeVisible();
    await expect(canvas.getByRole('button', { name: /确认导入/ })).toBeDisabled();
    await userEvent.click(body.getByRole('button', { name: '刷新核对内容' }));
    await body.findByRole('button', { name: '更正交易状态' });
    await userEvent.click(body.getByRole('button', { name: '核对并处理' }));
    await userEvent.type(body.getByLabelText('核对依据'), '合成重新核对依据');
    await userEvent.click(body.getByRole('button', { name: '应用并确认核对' }));
    await body.findByText('已核对');
    await expect(reviewed).toHaveBeenLastCalledWith(expect.objectContaining({ expected_version: 2 }));
  },
};

export const ReviewVisual: Story = {
  name: '核对窗口展示',
  play: async ({ canvasElement }) => {
    await upload(canvasElement);
    await userEvent.click(within(canvasElement).getByRole('button', { name: '处理下一条' }));
    await within(canvasElement.ownerDocument.body).findByRole('button', { name: '核对并处理' });
  },
};

export const FeeVisual: Story = {
  name: '运费候选窗口展示',
  beforeEach: FeeSameBatch.beforeEach,
  play: async ({ canvasElement }) => {
    await upload(canvasElement);
    await userEvent.click(within(canvasElement).getByRole('button', { name: '查找关联订阅' }));
    await within(canvasElement.ownerDocument.body).findByText('本批待导入');
  },
};
