import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';
import { message } from 'antd';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import OrderImport from './OrderImport';
import type { CoverageCandidate, CoverageChange } from '../api/orderCoverage';
import type { ImportPreviewOut, ImportPreviewRow } from '../api/orderImport';

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

const schemaUpgradeMessage = '订单来源交易的数据库升级尚未完成，暂时无法导入。请管理员完成数据库迁移后重新预览。';

export const SchemaUpgradeRequired: Story = {
  name: '缺少数据库迁移时保留明确提示',
  parameters: { msw: { handlers: [
    http.post('/api/order-import/preview', () => HttpResponse.json({ detail: schemaUpgradeMessage }, { status: 503 })),
  ] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.upload(canvasElement.querySelector('input[type="file"]') as HTMLInputElement, new File(['synthetic'], 'synthetic.xlsx'));
    await userEvent.click(canvas.getByRole('button', { name: /预览导入/ }));
    await expect(await canvas.findByText('预览未完成')).toBeVisible();
    await expect(canvas.getByText(schemaUpgradeMessage)).toBeVisible();
    await expect(canvas.getByText('synthetic.xlsx')).toBeVisible();
    await expect(canvas.getByRole('button', { name: /预览导入/ })).toBeEnabled();
    await expect(canvas.queryByRole('button', { name: /确认导入/ })).not.toBeInTheDocument();
  },
};

let previewRetryCount = 0;
export const PreviewFailureRetry: Story = {
  name: '服务器异常后保留文件并重新预览',
  beforeEach: () => { previewRetryCount = 0; },
  parameters: { msw: { handlers: [
    http.post('/api/order-import/preview', () => {
      previewRetryCount += 1;
      if (previewRetryCount === 1) return HttpResponse.text('Internal Server Error', { status: 500 });
      return HttpResponse.json({ session_id: 'synthetic-retry', counts: { total: 0 }, can_commit: false, rows: [] });
    }),
  ] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.upload(canvasElement.querySelector('input[type="file"]') as HTMLInputElement, new File(['synthetic'], 'synthetic.xlsx'));
    await userEvent.click(canvas.getByRole('button', { name: /预览导入/ }));
    await expect(await canvas.findByText(/服务器处理异常；若系统刚升级，请确认数据库迁移已完成/)).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: /预览导入/ }));
    await expect(await canvas.findByText('当前显示 0 笔 / 全部 0 笔')).toBeVisible();
    await expect(canvas.queryByText('预览未完成')).not.toBeInTheDocument();
    await expect(canvas.getByText('synthetic.xlsx')).toBeVisible();
    await expect(previewRetryCount).toBe(2);
  },
};

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
    await waitFor(() => expect(body.getByText(/订期：2026-03-01 至 2027-02-28/)).toBeVisible());
    await userEvent.click(body.getByRole('button', { name: '确认导入 1 笔' }));
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
    await expect(await body.findByRole('button', { name: '确认导入 17 笔' })).toBeEnabled();
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

let filterPreviewCount = 0;
const committedFilteredBatch = fn();
const filterHandlers = [
  http.post('/api/order-import/preview', () => {
    const resolved = filterPreviewCount++ > 0;
    const rows: ImportPreviewRow[] = Array.from({ length: 56 }, (_, index) => {
      const decision = index < 51 || (resolved && index >= 54) ? 'import'
        : index === 51 ? 'skip_status' : index < 54 ? 'duplicate' : 'unresolved';
      return {
        external_order_no: `SYNTHETIC-FILTER-${index}`, recipient_name: `合成订户${index}`, paid_amount: '199.00',
        status_raw: index === 51 ? '已取消' : '卖家已发货', commercial_status: index === 51 ? 'cancelled' : 'shipped',
        decision, reason: decision === 'unresolved' ? '纯运费单需核对' : decision === 'duplicate' ? '订单号已存在' : decision === 'skip_status' ? '取消订单不导入' : null,
        status_unknown: false, delivery_overridden_to_zto: false, warnings: [], unresolved_product: null,
        items: decision === 'import' ? [{
          publication: index === 1 ? 'business_school' : 'cbj', fulfillment_type: index < 2 ? 'single_issue' : 'subscription',
          subscription_term: index < 2 ? null : 'one_year', delivery_method: 'post_office', billing_type: 'paid',
          total_quantity: 1, unit_price: '199.00', subtotal: '199.00', issue_label: null, issue_number: null,
          coverage_start_date: null, coverage_end_date: null,
        }] : [],
      };
    });
    return HttpResponse.json({ session_id: 'synthetic-filter-session', rows, can_commit: true,
      counts: { total: 56, import: resolved ? 53 : 51, skip_status: 1, duplicate: 2, unresolved: resolved ? 0 : 2 },
    } satisfies ImportPreviewOut);
  }),
  http.post('/api/order-import/commit', async ({ request }) => {
    committedFilteredBatch(await request.json());
    return HttpResponse.json({ created: 51, order_ids: [], skipped_duplicates: 0 });
  }),
];

async function previewFilterFile(canvasElement: HTMLElement) {
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.click(body.getByText('历史归档（只补记录）'));
  await userEvent.upload(canvasElement.querySelector('input[type="file"]') as HTMLInputElement, new File(['synthetic'], 'synthetic-filters.xlsx'));
  await userEvent.click(body.getByRole('button', { name: /预览导入/ }));
  await body.findByRole('button', { name: '全部 56' });
  return body;
}

export const FilterResults: Story = {
  name: '跨页筛选并保留补期与整批导入',
  parameters: { msw: { handlers: filterHandlers } },
  beforeEach: () => { filterPreviewCount = 0; committedFilteredBatch.mockClear(); },
  play: async ({ canvasElement }) => {
    const body = await previewFilterFile(canvasElement);
    const filters = within(body.getByRole('group', { name: '按识别结果筛选' }));
    await expect(filters.getByRole('button', { name: '全部 56' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.type(body.getByRole('spinbutton'), '2677');
    await userEvent.type(body.getByPlaceholderText('选填，如 2026-06'), '2026-08');
    await userEvent.click(body.getByTitle('2'));
    await expect(body.getByText('SYNTHETIC-FILTER-50')).toBeVisible();

    // 问题订单在原列表第二页，筛选必须作用于完整预览并回到第一页。
    await userEvent.click(filters.getByRole('button', { name: '待确认 2' }));
    await expect(body.getByText('当前显示 2 笔 / 全部 56 笔')).toBeVisible();
    await expect(body.getByText('SYNTHETIC-FILTER-54')).toBeVisible();
    await expect(body.queryByText('SYNTHETIC-FILTER-50')).not.toBeInTheDocument();
    await expect(canvasElement.querySelectorAll('tbody tr.ant-table-row')).toHaveLength(2);

    // 原生按钮支持键盘，筛选后整批计数保持不变。
    filters.getByRole('button', { name: '重复 2' }).focus();
    await userEvent.keyboard('{Enter}');
    await expect(filters.getByRole('button', { name: '重复 2' })).toHaveAttribute('aria-pressed', 'true');
    await expect(body.getByText('SYNTHETIC-FILTER-52')).toBeVisible();
    await userEvent.click(filters.getByRole('button', { name: '跳过 1' }));
    await expect(body.getByText('取消订单不导入')).toBeVisible();
    await userEvent.click(filters.getByRole('button', { name: '可导入 51' }));
    await expect(body.getByRole('spinbutton')).toHaveValue('2677');
    await expect(body.getByPlaceholderText('选填，如 2026-06')).toHaveValue('2026-08');
    await expect(body.getByText('当前显示 51 笔 / 全部 56 笔')).toBeVisible();

    await userEvent.click(filters.getByRole('button', { name: '重复 2' }));
    await userEvent.click(body.getByRole('button', { name: '确认导入 51 笔' }));
    await waitFor(() => expect(committedFilteredBatch).toHaveBeenCalledWith({
      session_id: 'synthetic-filter-session', issue_overrides: { 'SYNTHETIC-FILTER-0#0': 2677 },
      issue_label_overrides: { 'SYNTHETIC-FILTER-1#0': '2026-08' },
    }));
    await expect(committedFilteredBatch).toHaveBeenCalledTimes(1);
  },
};

export const RefreshFilteredPreview: Story = {
  name: '重新识别保留分类与空结果',
  parameters: { msw: { handlers: filterHandlers } },
  beforeEach: () => { filterPreviewCount = 0; },
  play: async ({ canvasElement }) => {
    const body = await previewFilterFile(canvasElement);
    await userEvent.click(body.getByRole('button', { name: '待确认 2' }));
    await userEvent.click(body.getByRole('button', { name: /预览导入/ }));
    await waitFor(() => expect(body.getByText('当前没有“待确认”记录')).toBeVisible());
    await expect(body.getByRole('button', { name: '待确认 0' })).toHaveAttribute('aria-pressed', 'true');
    await expect(body.getByRole('button', { name: '确认导入 53 笔' })).toBeEnabled();
    await expect(body.getByText('当前显示 0 笔 / 全部 56 笔')).toBeVisible();
    await userEvent.upload(canvasElement.querySelector('input[type="file"]') as HTMLInputElement, new File(['another synthetic'], 'another-synthetic.xlsx'));
    await userEvent.click(body.getByRole('button', { name: /预览导入/ }));
    await waitFor(() => expect(body.getByRole('button', { name: '全部 56' })).toHaveAttribute('aria-pressed', 'true'));
    await expect(body.getByText('SYNTHETIC-FILTER-0')).toBeVisible();
  },
};

export const DarkCompactFilters: Story = {
  name: '暗色紧凑筛选待确认', globals: { theme: 'dark', density: 'compact' },
  parameters: { msw: { handlers: filterHandlers } },
  beforeEach: () => { filterPreviewCount = 0; },
  play: async ({ canvasElement }) => {
    const body = await previewFilterFile(canvasElement);
    await userEvent.click(body.getByRole('button', { name: '待确认 2' }));
    await expect(body.getByRole('button', { name: '待确认 2' })).toHaveAttribute('aria-pressed', 'true');
    await expect(body.getByText('当前显示 2 笔 / 全部 56 笔')).toBeVisible();
  },
};

const importTransactions = fn();
const transactionRows: ImportPreviewRow[] = [
  { external_order_no: 'SYNTHETIC-REFUND', decision: 'import', reason: null },
  { external_order_no: 'SYNTHETIC-FEE', decision: 'retain', reason: '纯运费记录：仅保存交易，不新增订阅或发货；可到来源交易关联订阅' },
  { external_order_no: 'SYNTHETIC-LEGACY', decision: 'retain', reason: '补充订单原件：仅保存交易，不重复建单、不覆盖人工修改' },
  { external_order_no: 'SYNTHETIC-UNKNOWN-REFUND', decision: 'unresolved', reason: '商品库无匹配', unresolved_product: promoAlias },
].map(row => ({
  recipient_name: '合成测试订户', paid_amount: '150.00', status_raw: '卖家已退款', commercial_status: 'refunded',
  status_unknown: false, delivery_overridden_to_zto: false, warnings: [], unresolved_product: null, items: [],
  ...row,
} as ImportPreviewRow));

const transactionHandlers = [
  http.post('/api/order-import/preview', () => HttpResponse.json({
    session_id: 'synthetic-transactions', can_commit: true, rows: transactionRows,
    counts: { total: 4, import: 1, retain: 2, unresolved: 1 },
  } satisfies ImportPreviewOut)),
  http.post('/api/order-import/commit', async ({ request }) => {
    importTransactions(await request.json());
    return HttpResponse.json({ created: 1, order_ids: [], retained_sources: 2, skipped_duplicates: 0 });
  }),
  http.get('/api/products', () => HttpResponse.json([existingPromo])),
];

export const ImportTransactions: Story = {
  name: '运费及原件归入可导入，未知退款留在待确认',
  parameters: { msw: { handlers: transactionHandlers } },
  beforeEach: () => { importTransactions.mockClear(); message.destroy(); },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.upload(canvasElement.querySelector('input[type="file"]') as HTMLInputElement, new File(['synthetic'], 'synthetic-transactions.xlsx'));
    await userEvent.click(body.getByRole('button', { name: /预览导入/ }));
    const filters = within(await body.findByRole('group', { name: '按识别结果筛选' }));
    await expect(filters.queryByRole('button', { name: /留存/ })).not.toBeInTheDocument();
    await expect(filters.getAllByRole('button')).toHaveLength(6);
    await userEvent.click(filters.getByRole('button', { name: '可导入 3' }));
    await expect(body.getByText('SYNTHETIC-FEE')).toBeVisible();
    await expect(body.getByText('SYNTHETIC-LEGACY')).toBeVisible();
    await expect(body.queryByText('SYNTHETIC-UNKNOWN-REFUND')).not.toBeInTheDocument();
    await expect(canvasElement.querySelectorAll('tbody tr.ant-table-row')).toHaveLength(3);
    await expect(body.getByText(/纯运费记录：仅保存交易/)).toBeVisible();
    await userEvent.click(filters.getByRole('button', { name: '待确认 1' }));
    await expect(body.getByText('SYNTHETIC-UNKNOWN-REFUND')).toBeVisible();
    await userEvent.click(body.getByText('SYNTHETIC-UNKNOWN-REFUND'));
    await waitFor(() => expect(body.getByRole('combobox', { name: '选择已有商品' })).toBeVisible());
    await userEvent.click(body.getByRole('button', { name: /取\s*消/ }));
    // 当前只显示待确认，确认仍处理整批 3 笔可导入记录。
    await userEvent.click(body.getByRole('button', { name: '确认导入 3 笔' }));
    await waitFor(() => expect(importTransactions).toHaveBeenCalledWith({ session_id: 'synthetic-transactions' }));
    await waitFor(() => expect(body.getByText(/导入完成：新建 1 单，保存 2 笔交易记录/)).toBeVisible());
  },
};

export const DarkCompactTransactions: Story = {
  ...ImportTransactions,
  name: '暗色紧凑的交易导入与退款待确认',
  globals: { theme: 'dark', density: 'compact' },
};

export const FeeOnlyImport: Story = {
  name: '只有运费及补原件时也能确认导入',
  parameters: { msw: { handlers: [
    http.post('/api/order-import/preview', () => HttpResponse.json({
      session_id: 'synthetic-fees', can_commit: true, rows: transactionRows.slice(1, 3),
      counts: { total: 2, import: 0, retain: 2 },
    } satisfies ImportPreviewOut)),
    http.post('/api/order-import/commit', async ({ request }) => {
      importTransactions(await request.json());
      return HttpResponse.json({ created: 0, order_ids: [], retained_sources: 2, skipped_duplicates: 0 });
    }),
  ] } },
  beforeEach: () => { importTransactions.mockClear(); message.destroy(); },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.upload(canvasElement.querySelector('input[type="file"]') as HTMLInputElement, new File(['synthetic'], 'synthetic-fees.xlsx'));
    await userEvent.click(body.getByRole('button', { name: /预览导入/ }));
    await userEvent.click(await body.findByRole('button', { name: '可导入 2' }));
    await expect(body.getByText('当前显示 2 笔 / 全部 2 笔')).toBeVisible();
    await userEvent.click(body.getByRole('button', { name: '待确认 0' }));
    await expect(body.getByText('当前没有“待确认”记录')).toBeVisible();
    await userEvent.click(body.getByRole('button', { name: '确认导入 2 笔' }));
    await waitFor(() => expect(importTransactions).toHaveBeenCalledWith({ session_id: 'synthetic-fees' }));
    await waitFor(() => expect(body.getByText(/导入完成：新建 0 单，保存 2 笔交易记录/)).toBeVisible());
  },
};

const detailSnapshot = {
  platform: 'CBJ小程序', external_order_no: 'SYNTHETIC-DETAIL',
  status_raw: '卖家已退款', commercial_status: 'refunded', paid_amount: '150.00', original_amount: '150.00',
  recipient_name: '合成测试订户', recipient_phone: '13800000000',
  recipient_address: '合成省合成市测试区报刊路18号' + '合成长地址'.repeat(12), recipient_postal_code: '000000',
  payment_method: '微信', order_date: '2026-09-01', payment_time: '2026-09-01T09:30:00', notes: '',
  invoice: '合成开票公司\t\n合成税号0001', filename: 'synthetic-detail.xlsx', source_sheet: '合成订单', source_row: 12,
  product_lines: [{ name: '合成中通运费', raw: '合成中通运费 X50,单价:3.00', quantity: 50, unit_price: '3.00', is_shipping: true, mentions_zto: true }],
  raw_cells: { status: '卖家已退款', paid_amount: '150.00', product: '合成中通运费 X50,单价:3.00', invoice: '合成开票公司\t\n合成税号0001', merchant_note: '合成补充备注', sku: '运费', tracking: 'SYNTHETIC-TRACKING-' + '0'.repeat(100) },
};
const detailRow: ImportPreviewRow = {
  ...transactionRows[1], external_order_no: 'SYNTHETIC-DETAIL', source_snapshot: detailSnapshot,
};
const detailHandlers = [http.post('/api/order-import/preview', () => HttpResponse.json({
  session_id: 'synthetic-detail', counts: { retain: 1 }, can_commit: true, rows: [detailRow],
} satisfies ImportPreviewOut))];

async function openImportDetail(canvasElement: HTMLElement) {
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.upload(canvasElement.querySelector('input[type="file"]') as HTMLInputElement, new File(['synthetic'], 'synthetic-detail.xlsx'));
  await userEvent.click(body.getByRole('button', { name: /预览导入/ }));
  await userEvent.click(await body.findByRole('cell', { name: 'SYNTHETIC-DETAIL' }));
  return body.findByRole('dialog');
}

export const ReadableImportDetail: Story = {
  name: '紧凑中文详情、长地址与开票信息',
  parameters: { msw: { handlers: detailHandlers } },
  play: async ({ canvasElement }) => {
    const dialog = await openImportDetail(canvasElement);
    const detail = within(dialog);
    await expect(detail.queryAllByText('"150.00"')).toHaveLength(0);
    await expect(within(detail.getByRole('region', { name: '交易信息' })).getByText('¥150.00')).toBeVisible();
    await expect(detail.getByText('2026-09-01 09:30:00')).toBeVisible();
    await expect(detail.queryByText(/refunded/)).not.toBeInTheDocument();
    await expect(detail.queryByText('全部原始字段')).not.toBeInTheDocument();
    await userEvent.click(detail.getByText('开票及其他信息'));
    await expect(detail.getAllByText(/合成开票公司/)[0]).toBeVisible();
    await userEvent.click(detail.getByText('查看原表信息'));
    await expect(detail.getByText('商家备注')).toBeVisible();
    await expect(detail.getByText('合成补充备注')).toBeVisible();
    const label = within(detail.getByRole('region', { name: '交易信息' })).getByText('原付款金额');
    expect(getComputedStyle(label).whiteSpace).toBe('nowrap');
    expect(label.getBoundingClientRect().height).toBeLessThan(30);
    const content = dialog.querySelector('.ant-drawer-body')!;
    expect(content.scrollWidth).toBeLessThanOrEqual(content.clientWidth);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(dialog).not.toBeVisible());
  },
};

export const DarkCompactImportDetail: Story = {
  ...ReadableImportDetail,
  name: '暗色紧凑的中文导入详情', globals: { theme: 'dark', density: 'compact' },
};

const confirmSourceChange = fn();
export const ReviewSourceChanges: Story = {
  name: '核对清空及原表补充字段后才保存来源更新',
  beforeEach: () => { confirmSourceChange.mockClear(); message.destroy(); },
  parameters: { msw: { handlers: [
    http.post('/api/order-import/preview', () => HttpResponse.json({
      session_id: 'synthetic-source-change', counts: { source_update: 1 }, can_commit: true,
      rows: [{ ...detailRow, decision: 'source_update', reason: '原始交易有变化，请核对前后信息并确认更新',
        previous_snapshot: { ...detailSnapshot, notes: '工作日收件', raw_cells: { ...detailSnapshot.raw_cells, merchant_note: '旧补充备注' } },
      }],
    } satisfies ImportPreviewOut)),
    http.post('/api/order-import/commit', async ({ request }) => {
      const payload = await request.json() as { confirmed_source_updates?: string[] };
      if (!payload.confirmed_source_updates?.includes('SYNTHETIC-DETAIL')) return HttpResponse.json({ detail: '请先逐笔核对来源变化' }, { status: 409 });
      confirmSourceChange(payload);
      return HttpResponse.json({ created: 0, order_ids: [], retained_sources: 0, skipped_duplicates: 0 });
    }),
  ] } },
  play: async ({ canvasElement }) => {
    const dialog = await openImportDetail(canvasElement);
    const detail = within(dialog);
    const body = within(canvasElement.ownerDocument.body);
    await expect(detail.getByText('需要核对的变化 · 2 项')).toBeVisible();
    await expect(detail.getByText('已清空')).toBeVisible();
    await expect(detail.getByText('原表 · 商家备注')).toBeVisible();
    const checkbox = detail.getByRole('checkbox', { name: '我已核对以上变化，确认保存新版本' });
    await expect(checkbox).not.toBeChecked();
    await userEvent.click(detail.getByRole('button', { name: '关闭' }));
    await userEvent.click(body.getByRole('button', { name: /确认导入/ }));
    await expect(await body.findByText('导入未完成')).toBeVisible();
    await expect(confirmSourceChange).not.toHaveBeenCalled();
    await userEvent.click(body.getByText('SYNTHETIC-DETAIL'));
    await userEvent.click(within(await body.findByRole('dialog')).getByRole('checkbox', { name: '我已核对以上变化，确认保存新版本' }));
    await userEvent.click(within(await body.findByRole('dialog')).getByRole('button', { name: '关闭' }));
    await userEvent.click(body.getByRole('button', { name: /确认导入/ }));
    await waitFor(() => expect(confirmSourceChange).toHaveBeenCalledWith({ session_id: 'synthetic-source-change', confirmed_source_updates: ['SYNTHETIC-DETAIL'] }));
  },
};

export const ReadOnlySourceChanges: Story = {
  name: '只读账号可看变化但不能勾选保存',
  parameters: {
    ...ReviewSourceChanges.parameters,
    auth: { ...meta.parameters.auth, isAdmin: false, canMutate: false },
  },
  play: async ({ canvasElement }) => {
    const detail = within(await openImportDetail(canvasElement));
    await expect(detail.getByText('已清空')).toBeVisible();
    await expect(detail.getByRole('checkbox', { name: '我已核对以上变化，确认保存新版本' })).toBeDisabled();
  },
};

export const MissingPreviousSnapshot: Story = {
  name: '缺少上次来源详情时提示重新预览',
  parameters: { msw: { handlers: [http.post('/api/order-import/preview', () => HttpResponse.json({
    session_id: 'synthetic-missing-snapshot', can_commit: true, counts: { source_update: 1 },
    rows: [{ ...detailRow, decision: 'source_update', previous_snapshot: null }],
  } satisfies ImportPreviewOut))] } },
  play: async ({ canvasElement }) => {
    const detail = within(await openImportDetail(canvasElement));
    await expect(detail.getByText('暂时无法展示来源变化，请重新预览后核对')).toBeVisible();
    await expect(detail.getByRole('checkbox', { name: '我已核对以上变化，确认保存新版本' })).toBeDisabled();
  },
};

export const MultipleProductsAndUnknownStatus: Story = {
  name: '多商品、缺订期及未知状态提醒',
  parameters: { msw: { handlers: [http.post('/api/order-import/preview', () => HttpResponse.json({
    session_id: 'synthetic-multiple-products', can_commit: true, counts: { import: 1 },
    rows: [{ ...detailRow, decision: 'import', reason: null, status_unknown: true, commercial_status: 'paid', status_raw: '合成特殊状态',
      source_snapshot: { ...detailSnapshot, commercial_status: 'paid', status_raw: '合成特殊状态', product_lines: [
        { name: '合成全年订阅', quantity: 1, unit_price: '150.00' }, { name: '合成赠刊', quantity: 1, unit_price: '0.00' },
      ] },
      items: [{ publication: 'cbj', fulfillment_type: 'subscription', billing_type: 'paid', subscription_term: 'one_year', delivery_method: 'post_office',
        total_quantity: 1, unit_price: '150.00', subtotal: '150.00', issue_label: null, issue_number: null, coverage_start_date: null, coverage_end_date: null }],
    }],
  } satisfies ImportPreviewOut))] } },
  play: async ({ canvasElement }) => {
    const detail = within(await openImportDetail(canvasElement));
    await expect(detail.getByText('平台状态需要人工核对')).toBeVisible();
    await expect(detail.getByText('合成全年订阅')).toBeVisible();
    await expect(detail.getByText('合成赠刊')).toBeVisible();
    await expect(detail.getByText('订期：未填写')).toBeVisible();
    await userEvent.click(detail.getByText('开票及其他信息'));
    await expect(detail.getByText('状态待核对')).toBeVisible();
    await expect(detail.queryByText('已付款')).not.toBeInTheDocument();
  },
};
