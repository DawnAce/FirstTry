import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import OrderImport from './OrderImport';
import type { ImportPreviewOut } from '../api/orderImport';

const committed = fn();
const warning = '翻期临界（周五约 22 点 ±4h）：自动判为第 2638 期，请核对';
const item = {
  publication: 'cbj', fulfillment_type: 'single_issue', billing_type: 'paid', subscription_term: null,
  delivery_method: 'zto_mf', issue_label: null, issue_number: 2638, total_quantity: 1,
  unit_price: '5.00', subtotal: '5.00', coverage_start_date: null, coverage_end_date: null,
  issue_review: { suggested_issue_number: 2638, suggested_publish_date: '2026-01-26', reason: warning },
};
const previewData: ImportPreviewOut = {
  session_id: 'synthetic-issue-review', can_commit: true, counts: { total: 52, import: 52 },
  issue_review_options: [{ issue_number: 2639, publish_date: '2026-02-02' },
    { issue_number: 2638, publish_date: '2026-01-26' }, { issue_number: 2637, publish_date: '2026-01-19' }],
  rows: Array.from({ length: 52 }, (_, index) => ({
    external_order_no: `SYNTHETIC-REVIEW-${index}`, recipient_name: '合成测试订户', paid_amount: '10.00',
    status_raw: '卖家已发货', commercial_status: 'shipped', decision: 'import', reason: null,
    status_unknown: false, delivery_overridden_to_zto: false, unresolved_product: null,
    warnings: index === 51 ? [warning, warning] : [],
    source_snapshot: { payment_time: '2026-01-23T23:00:00', order_date: '2026-01-23', recipient_name: '合成测试订户' },
    items: index === 51 ? [item, item] : [{ ...item, issue_review: null }],
  })),
};
const meta = {
  title: '页面/营销与交易/电商订单导入期号核对', component: OrderImport,
  parameters: {
    layout: 'fullscreen',
    auth: { user: { id: 1, username: 'synthetic-admin', role: 'admin' }, isAdmin: true, canMutate: true, isLoggedIn: true, setAuth: fn(), logout: fn() },
    msw: { handlers: [
      http.post('/api/order-import/preview', () => HttpResponse.json(previewData)),
      http.post('/api/order-import/commit', async ({ request }) => {
        committed(await request.json());
        return HttpResponse.json({ created: 52, order_ids: [], skipped_duplicates: 0 });
      }),
    ] },
  },
  beforeEach: () => { committed.mockClear(); },
} satisfies Meta<typeof OrderImport>;
export default meta;
type Story = StoryObj<typeof meta>;

export const RecognizedIssueDates: Story = {
  name: '单期发货期号与出版日期醒目展示',
  parameters: { msw: { handlers: [http.post('/api/order-import/preview', () => HttpResponse.json({
    ...previewData, counts: { total: 4, import: 4 }, issue_review_options: [],
    rows: [0, 1, 2, 3].map(index => ({
      ...previewData.rows[0], external_order_no: `SYNTHETIC-CLEAN-${index}`,
      items: [{ ...item, issue_review: null,
        fulfillment_type: index === 3 ? 'subscription' : 'single_issue',
        issue_number: index === 3 ? null : 2638 + index,
        issue_publish_date: index < 2 ? ['2026-01-26', '2026-02-02'][index] : null,
      }],
    })),
  } satisfies ImportPreviewOut))] } },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.upload(canvasElement.querySelector('input[type="file"]') as HTMLInputElement, new File(['synthetic'], 'synthetic-issue.xlsx'));
    await userEvent.click(body.getByRole('button', { name: /预览导入/ }));
    await expect(await body.findByRole('button', { name: '确认导入 4 笔' })).toBeEnabled();
    const badges = body.getAllByRole('group', { name: '单期发货期次' });
    await expect(badges).toHaveLength(3);
    await expect(within(badges[0]).getByText('第 2638 期')).toBeVisible();
    await expect(within(badges[0]).getByText('2026-01-26 出版')).toBeVisible();
    await expect(within(badges[1]).getByText('2026-02-02 出版')).toBeVisible();
    await expect(within(badges[2]).queryByText('自动识别')).not.toBeInTheDocument();
    await expect(body.getAllByText('自动识别')).toHaveLength(2);
    await expect(body.getAllByText(/订期：.*未填写/)).toHaveLength(1);
    await expect(body.queryByText('导入前请完成核对')).not.toBeInTheDocument();
    await userEvent.click(body.getByText('SYNTHETIC-CLEAN-0'));
    const dialog = within(await body.findByRole('dialog'));
    const badge = dialog.getByRole('group', { name: '单期发货期次' });
    await expect(within(badge).getByText('2026-01-26 出版')).toBeVisible();
    await expect(within(badge).getByText('自动识别')).toBeVisible();
    await expect(dialog.queryByText(/订期：/)).not.toBeInTheDocument();
    const content = badge.closest('.ant-drawer-body')!;
    expect(content.scrollWidth).toBeLessThanOrEqual(content.clientWidth);
    await userEvent.click(dialog.getByRole('button', { name: '关闭' }));
  },
};

export const DarkCompactRecognizedIssueDates: Story = {
  ...RecognizedIssueDates, name: '暗色紧凑单期发货期次', globals: { theme: 'dark', density: 'compact' },
};

async function openPending(canvasElement: HTMLElement) {
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.upload(canvasElement.querySelector('input[type="file"]') as HTMLInputElement, new File(['synthetic'], 'synthetic-issue.xlsx'));
  await userEvent.click(body.getByRole('button', { name: /预览导入/ }));
  await expect(await body.findByRole('button', { name: '确认导入 52 笔' })).toBeDisabled();
  await userEvent.click(body.getByRole('button', { name: '期号 2 条' }));
  await expect(body.getByText('SYNTHETIC-REVIEW-51')).toBeVisible();
  return body;
}

export const PendingIssueReview: Story = {
  name: '跨页定位两条待核对明细',
  play: async ({ canvasElement }) => {
    const body = await openPending(canvasElement);
    await expect(body.getAllByRole('button', { name: '确认第 2638 期' })).toHaveLength(2);
    await expect(body.getAllByRole('button', { name: '修改期号' })).toHaveLength(2);
    await expect(body.getByText('导入前请完成核对')).toBeVisible();
    await expect(committed).not.toHaveBeenCalled();
  },
};

export const ReviewAndCorrectIssue: Story = {
  name: '逐明细核对、详情修改与整批提交',
  play: async ({ canvasElement }) => {
    const body = await openPending(canvasElement);
    const first = within(body.getByRole('group', { name: '第 1 条明细期号核对' }));
    first.getByRole('button', { name: '确认第 2638 期' }).focus();
    await userEvent.keyboard('{Enter}');
    await expect(body.getByRole('button', { name: '确认导入 52 笔' })).toBeDisabled();
    await userEvent.click(body.getByText('SYNTHETIC-REVIEW-51'));
    const dialog = within(await body.findByRole('dialog'));
    const confirmedPeriod = within(dialog.getByRole('group', { name: '第 1 条明细期号核对' }));
    await expect(confirmedPeriod.getByText('第 2638 期')).toBeVisible();
    await expect(confirmedPeriod.getByText('已核对')).toBeVisible();
    await expect(confirmedPeriod.getByRole('group', { name: '单期发货期次' })).toHaveAttribute('data-tone', 'success');
    const second = within(dialog.getByRole('group', { name: '第 2 条明细期号核对' }));
    await userEvent.click(second.getByRole('button', { name: '修改期号' }));
    await userEvent.click(second.getByRole('combobox', { name: '选择核对期号' }));
    await userEvent.click(body.getByText('第 2637 期 · 2026-01-19 出版', { selector: '.ant-select-item-option-content' }));
    await userEvent.click(second.getByRole('button', { name: '确认第 2637 期' }));
    await userEvent.click(dialog.getByRole('button', { name: '关闭' }));
    await expect(body.getByRole('button', { name: '确认导入 52 笔' })).toBeEnabled();
    await expect(body.getByText('当前没有“期号待核对”记录')).toBeVisible();
    await userEvent.click(body.getByRole('button', { name: '可导入 52' }));
    await userEvent.click(body.getByRole('button', { name: '确认导入 52 笔' }));
    await waitFor(() => expect(committed).toHaveBeenCalledWith({ session_id: 'synthetic-issue-review',
      confirmed_issue_numbers: { 'SYNTHETIC-REVIEW-51#0': 2638, 'SYNTHETIC-REVIEW-51#1': 2637 } }));
  },
};

export const EditingAndRepreviewRequireReview: Story = {
  name: '修改撤销核对、重新预览清除旧核对',
  play: async ({ canvasElement }) => {
    const body = await openPending(canvasElement);
    const first = within(body.getByRole('group', { name: '第 1 条明细期号核对' }));
    await userEvent.click(first.getByRole('button', { name: '确认第 2638 期' }));
    await userEvent.click(first.getByRole('button', { name: '修改期号' }));
    await expect(first.queryByText('已核对')).not.toBeInTheDocument();
    await expect(body.getByRole('button', { name: '期号 2 条' })).toBeVisible();
    await userEvent.click(first.getByRole('button', { name: '确认第 2638 期' }));
    await userEvent.click(body.getByRole('button', { name: /预览导入/ }));
    const modal = within(await body.findByRole('dialog'));
    await waitFor(() => expect(modal.getByText(/期号核对/)).toBeVisible());
    await userEvent.click(modal.getByRole('button', { name: '保留当前预览' }));
    await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument());
    await expect(body.getByText('已核对', { selector: '.order-import-period-status' })).toBeVisible();
    await userEvent.click(body.getByRole('button', { name: /预览导入/ }));
    await userEvent.click(within(await body.findByRole('dialog')).getByRole('button', { name: '清除并继续' }));
    await waitFor(() => expect(body.queryByText('已核对', { selector: '.order-import-period-status' })).not.toBeInTheDocument());
    await expect(body.getAllByRole('button', { name: '确认第 2638 期' })).toHaveLength(2);
    await expect(body.getByRole('button', { name: '确认导入 52 笔' })).toBeDisabled();
  },
};

export const DarkCompactReview: Story = {
  ...PendingIssueReview, name: '暗色紧凑期号核对', globals: { theme: 'dark', density: 'compact' },
};

export const ReadOnlyIssueReview: Story = {
  name: '只读账号不能核对期号',
  parameters: { auth: { ...meta.parameters.auth, isAdmin: false, canMutate: false } },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.upload(canvasElement.querySelector('input[type="file"]') as HTMLInputElement, new File(['synthetic'], 'synthetic-issue.xlsx'));
    await userEvent.click(body.getByRole('button', { name: /预览导入/ }));
    await userEvent.click(await body.findByRole('button', { name: '期号 2 条' }));
    for (const button of body.getAllByRole('button', { name: '确认第 2638 期' })) await expect(button).toBeDisabled();
    for (const button of body.getAllByRole('button', { name: '修改期号' })) await expect(button).toBeDisabled();
  },
};

export const MissingSchedule: Story = {
  name: '刊期表为空时提示先补齐',
  parameters: { msw: { handlers: [http.post('/api/order-import/preview', () => HttpResponse.json({ ...previewData, issue_review_options: [] }))] } },
  play: async ({ canvasElement }) => {
    const body = await openPending(canvasElement);
    await expect(body.getAllByText('刊期表没有可选期号，请补齐刊期表后重新预览。')).toHaveLength(2);
    for (const button of body.getAllByRole('button', { name: '确认第 2638 期' })) await expect(button).toBeDisabled();
  },
};
