import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import type { ImportItemPreview, ImportPreviewOut, ImportPreviewRow } from '../api/orderImport';
import OrderImport from './OrderImport';

const single: ImportItemPreview = {
  publication: 'business_school', fulfillment_type: 'single_issue', billing_type: 'paid', subscription_term: null,
  delivery_method: null, issue_label: '2026-10', issue_number: null, total_quantity: 1,
  unit_price: '40.00', subtotal: '40.00', coverage_start_date: null, coverage_end_date: null,
};
function row(index: number, item: ImportItemPreview, extra: Partial<ImportPreviewRow> = {}): ImportPreviewRow {
  return {
    external_order_no: `SYNTHETIC-MARKER-${index}`, recipient_name: '合成测试订户', paid_amount: '40.00',
    status_raw: '卖家已发货', commercial_status: 'shipped', decision: 'import', reason: null,
    status_unknown: false, delivery_overridden_to_zto: false, unresolved_product: null, warnings: [], items: [item],
    source_snapshot: { order_date: '2026-10-01', payment_time: '2026-10-01T10:00:00' }, ...extra,
  };
}
const subscription = { ...single, publication: 'cbj', fulfillment_type: 'subscription', issue_label: null, subscription_term: 'one_year' };
const rows = [
  row(0, single, { items: [single, { ...single, fulfillment_type: 'gift', billing_type: 'free_gift', issue_label: null, unit_price: '0.00', subtotal: '0.00' }] }),
  row(1, { ...single, issue_label: '2026-02~03' }),
  row(2, { ...subscription, coverage_start_date: '2026-10-01', coverage_end_date: '2027-09-30' }),
  row(3, { ...subscription, coverage_end_date: '2027-09-30' }),
  row(4, { ...subscription, coverage_start_date: '2026-10-01' }),
  row(5, subscription),
  row(6, { ...single, publication: 'cbj', issue_label: null, issue_number: 2672, issue_publish_date: '2026-10-12' },
    { status_raw: '卖家已退款', commercial_status: 'refunded' }),
  row(7, { ...single, publication: 'cbj', issue_label: null, issue_number: 2673, issue_publish_date: '2026-10-19' },
    { status_raw: '部分退款', commercial_status: 'partial_refund' }),
];
const preview: ImportPreviewOut = { session_id: 'synthetic-markers', counts: { total: 8, import: 8 }, can_commit: true, rows };
const committed = fn();
const meta = {
  title: '页面/营销与交易/导入期次订期与状态标记', component: OrderImport,
  parameters: { layout: 'fullscreen',
    auth: { user: { id: 1, username: 'synthetic-admin', role: 'admin' }, isAdmin: true, canMutate: true, isLoggedIn: true, setAuth: fn(), logout: fn() },
    msw: { handlers: [
      http.post('/api/order-import/preview', () => HttpResponse.json(preview)),
      http.post('/api/order-import/commit', async ({ request }) => {
        committed(await request.json());
        return HttpResponse.json({ created: 1, order_ids: [], skipped_duplicates: 0 });
      }),
    ] },
  },
  beforeEach: () => { committed.mockClear(); },
} satisfies Meta<typeof OrderImport>;
export default meta;
type Story = StoryObj<typeof meta>;

async function upload(canvasElement: HTMLElement) {
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.upload(canvasElement.querySelector('input[type="file"]') as HTMLInputElement, new File(['synthetic'], 'synthetic-markers.xlsx'));
  await userEvent.click(body.getByRole('button', { name: /预览导入/ }));
  await body.findByText('SYNTHETIC-MARKER-0');
  return body;
}

export const UnifiedMarkers: Story = {
  name: '月刊合刊、完整缺失订期与退款状态',
  play: async ({ canvasElement }) => {
    const body = await upload(canvasElement);
    const periods = body.getAllByRole('group', { name: '单期发货期次' });
    await expect(periods).toHaveLength(4);
    await expect(within(periods[0]).getByText('2026年10月刊')).toBeVisible();
    await expect(within(periods[0]).getByText('自动识别')).toBeVisible();
    const giftedRow = within(body.getByText('SYNTHETIC-MARKER-0').closest('tr')!);
    await expect(giftedRow.getByText(/赠品/, { selector: '.ant-tag' })).toBeVisible();
    await expect(giftedRow.queryByRole('group', { name: '订阅起止日期' })).not.toBeInTheDocument();
    await expect(periods[0].querySelector('time')).toBeNull();
    await expect(within(periods[1]).getByText('2026年2–3月合刊')).toBeVisible();
    const coverage = body.getAllByRole('group', { name: '订阅起止日期' });
    await expect(coverage).toHaveLength(4);
    for (const [index, status] of ['已填写', '待补起始日期', '待补结束日期', '待补订期'].entries()) {
      await expect(within(coverage[index]).getByText(status)).toBeVisible();
    }
    const refundRow = within(body.getByText('SYNTHETIC-MARKER-6').closest('tr')!);
    await expect(refundRow.getByLabelText('交易状态')).toHaveTextContent('已退款');
    await expect(refundRow.getByText('已退款')).toHaveClass('ant-tag-red');
    const partialRow = within(body.getByText('SYNTHETIC-MARKER-7').closest('tr')!);
    await expect(partialRow.getByText('部分退款')).toHaveClass('ant-tag-orange');
    await expect(body.getByRole('button', { name: '确认导入 8 笔' })).toBeEnabled();
    await userEvent.click(body.getByText('SYNTHETIC-MARKER-6'));
    let dialog = within(await body.findByRole('dialog'));
    await expect(dialog.getByLabelText('交易状态')).toHaveTextContent('已退款');
    await expect(dialog.getByText('已退款')).toHaveClass('ant-tag-red');
    await expect(dialog.getByText('卖家已退款')).toBeVisible();
    await userEvent.click(dialog.getByRole('button', { name: '关闭' }));
    await userEvent.click(body.getByText('SYNTHETIC-MARKER-1'));
    dialog = within(await body.findByRole('dialog'));
    await expect(dialog.getByRole('group', { name: '单期发货期次' })).toHaveTextContent('2026年2–3月合刊');
    await expect(dialog.queryByText(/期2026/)).not.toBeInTheDocument();
    const content = dialog.getByRole('group', { name: '单期发货期次' }).closest('.ant-drawer-body')!;
    expect(content.scrollWidth).toBeLessThanOrEqual(content.clientWidth);
    await userEvent.click(dialog.getByRole('button', { name: '关闭' }));
    await expect(committed).not.toHaveBeenCalled();
  },
};

export const DarkCompactUnifiedMarkers: Story = {
  ...UnifiedMarkers, name: '暗色紧凑期次订期与退款', globals: { theme: 'dark', density: 'compact' },
};

export const ManualIssueMarkers: Story = {
  name: '逐明细人工补录回显、详情同步与提交',
  parameters: { msw: { handlers: [http.post('/api/order-import/preview', () => HttpResponse.json({
    ...preview, counts: { total: 1, import: 1 }, rows: [row(0, single, { items: [
      { ...single, publication: 'cbj', issue_label: null }, { ...single, issue_label: null },
    ] })],
  } satisfies ImportPreviewOut)), ...meta.parameters.msw.handlers] } },
  play: async ({ canvasElement }) => {
    const body = await upload(canvasElement);
    let badges = body.getAllByRole('group', { name: '单期发货期次' });
    await expect(within(badges[0]).getByText('期号未填写')).toBeVisible();
    await expect(within(badges[1]).getByText('期次未填写')).toBeVisible();
    const number = body.getByRole('spinbutton', { name: '明细 1 补期号' });
    number.focus();
    await userEvent.keyboard('2667');
    const label = body.getByRole('textbox', { name: '明细 2 补期次' });
    await userEvent.type(label, '2026-13');
    await expect(within(badges[1]).getByText('期次格式有误')).toBeVisible();
    await expect(within(badges[1]).queryByText('人工补录')).not.toBeInTheDocument();
    await userEvent.clear(label);
    await userEvent.type(label, '2026-06');
    await expect(within(badges[0]).getByText('第 2667 期')).toBeVisible();
    await expect(within(badges[1]).getByText('2026年6月刊')).toBeVisible();
    await expect(body.getAllByText('人工补录')).toHaveLength(2);
    await expect(body.queryByText('自动识别')).not.toBeInTheDocument();
    await expect(badges[0].querySelector('time')).toBeNull();
    await userEvent.click(body.getByRole('button', { name: '待确认 0' }));
    await userEvent.click(body.getByRole('button', { name: '可导入 1' }));
    await userEvent.click(body.getByText('SYNTHETIC-MARKER-0'));
    const dialog = within(await body.findByRole('dialog'));
    badges = dialog.getAllByRole('group', { name: '单期发货期次' });
    await expect(badges[0]).toHaveTextContent('第 2667 期');
    await expect(badges[1]).toHaveTextContent('2026年6月刊');
    await expect(dialog.getAllByText('人工补录')).toHaveLength(2);
    await userEvent.clear(dialog.getByRole('textbox', { name: '明细 2 补期次' }));
    await expect(badges[1]).toHaveTextContent('期次未填写');
    await userEvent.type(dialog.getByRole('textbox', { name: '明细 2 补期次' }), '2026-02~03');
    await userEvent.click(dialog.getByRole('button', { name: '关闭' }));
    await expect(body.getByText('2026年2–3月合刊')).toBeVisible();
    await userEvent.click(body.getByRole('button', { name: '确认导入 1 笔' }));
    await waitFor(() => expect(committed).toHaveBeenCalledWith({ session_id: 'synthetic-markers',
      issue_overrides: { 'SYNTHETIC-MARKER-0#0': 2667 }, issue_label_overrides: { 'SYNTHETIC-MARKER-0#1': '2026-02~03' } }));
  },
};

export const DarkCompactManualIssueMarkers: Story = {
  ...ManualIssueMarkers, name: '暗色紧凑人工补期次', globals: { theme: 'dark', density: 'compact' },
};
