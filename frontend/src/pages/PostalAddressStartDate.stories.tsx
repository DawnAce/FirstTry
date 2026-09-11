import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import type { PostalAddressChange } from '../api/postal';
import { AddressDetailDrawer } from './PostDelivery';

const change: PostalAddressChange = {
  id: 9901, postal_delivery_id: 9902, order_id: null, external_order_no: '2026-9901',
  change_date: '2026-03-16T10:00:00',
  old_name: '测试原收件人', old_phone: null, old_address: '测试原地址', old_copies: 2,
  new_name: '测试新收件人', new_phone: '00000000000', new_address: '测试新地址', new_copies: 1,
  original_start_month: '0101', effective_start_month: null,
  copy_allocations: null, unresolved_copies: 1,
  handling: null, routed_label: null, applied_to_order: true,
  applied_at: '2026-03-16T10:10:00', notes: null,
};
const dateHelp = '已带入收件信息，选择实际起投日期即可。保存后会记录本次补充。';
let savedDate: string | null = null;
const savedChange = (): PostalAddressChange => savedDate ? {
  ...change,
  copy_allocations: [
    { kind: 'changed', copies: 1, name: change.new_name, phone: change.new_phone, address: change.new_address, start_date: savedDate },
    { kind: 'pending', copies: 1, name: change.old_name, phone: null, address: change.old_address, start_date: '2026-01-01' },
  ],
} : change;

const getHandler = http.get('/api/postal/tickets/9901', () => HttpResponse.json(savedChange()));
const saveHandler = http.post('/api/postal/address-changes/9901/allocations/0/start-date', async ({ request }) => {
  const payload = await request.json() as { start_date: string; expected_allocation: unknown };
  await expect(payload).toEqual({
    start_date: '2026-04-01',
    expected_allocation: {
      kind: 'changed', copies: 1, name: change.new_name, phone: change.new_phone,
      address: change.new_address, start_date: null,
    },
  });
  savedDate = payload.start_date;
  return HttpResponse.json(savedChange());
});

const meta = {
  title: '页面/邮局投递/补充起投日期',
  component: AddressDetailDrawer,
  parameters: {
    layout: 'fullscreen',
    auth: { user: { username: 'admin', role: 'admin' }, isAdmin: true, isLoggedIn: true, setAuth: () => {}, logout: () => {} },
    msw: { handlers: [getHandler, saveHandler] },
  },
  args: { addressId: 9901, onClose: () => {}, onEdit: () => {} },
  beforeEach: () => { savedDate = null; },
} satisfies Meta<typeof AddressDetailDrawer>;
export default meta;
type Story = StoryObj<typeof meta>;

async function openDateDialog() {
  const body = within(document.body);
  const trigger = await body.findByRole('button', { name: '测试新收件人：补充起投日期' });
  await userEvent.click(trigger);
  // rc-util 在测试环境固定返回 test-id，嵌套弹窗的 aria-labelledby 会重名。
  const help = await body.findByText(dateHelp);
  const dialog = within(help.closest('[role="dialog"]') as HTMLElement);
  await waitFor(() => expect(dialog.getByText('测试新收件人')).toBeVisible());
  await expect(dialog.getByText('测试新地址')).toBeVisible();
  await expect(dialog.getAllByRole('textbox')).toHaveLength(1);
  return dialog;
}

export const MissingStartDate: Story = {
  name: '只选日期，保留收件信息与待确认份数',
  play: async () => {
    const body = within(document.body);
    const dialog = await openDateDialog();
    await userEvent.click(dialog.getByRole('button', { name: '保存起投日期' }));
    await waitFor(() => expect(dialog.getByText('请选择起投日期')).toBeVisible());
    await userEvent.type(dialog.getByRole('textbox', { name: /起投日期/ }), '2026-04-01');
    await userEvent.tab();
    await userEvent.click(dialog.getByRole('button', { name: '保存起投日期' }));
    await expect(await body.findByText('起投时间：2026-04-01')).toBeVisible();
    await expect(body.getByText('仍有 1 份收件人未确认')).toBeVisible();
    await waitFor(() => expect(body.queryByRole('textbox', { name: /起投日期/ })).not.toBeInTheDocument());
    await expect(body.queryByRole('button', { name: /补充起投日期/ })).not.toBeInTheDocument();
  },
};

export const DateDialog: Story = {
  name: '补日期弹窗',
  play: async () => { await openDateDialog(); },
};

export const DarkCompact: Story = {
  ...DateDialog,
  name: '暗色紧凑',
  globals: { theme: 'dark', density: 'compact' },
};

export const LightCompact: Story = {
  ...DateDialog,
  name: '亮色紧凑',
  globals: { theme: 'light', density: 'compact' },
};

export const DarkComfortable: Story = {
  ...DateDialog,
  name: '暗色舒适',
  globals: { theme: 'dark', density: 'comfortable' },
};

export const ViewOnly: Story = {
  name: '只读来源无补充入口',
  args: { readOnly: true },
  play: async () => {
    const body = within(document.body);
    await expect(await body.findByText('起投时间：待补充')).toBeVisible();
    await expect(body.queryByRole('button', { name: /补充起投日期/ })).not.toBeInTheDocument();
  },
};

export const NonAdmin: Story = {
  ...ViewOnly,
  name: '普通用户无补充入口',
  args: { readOnly: false },
  parameters: { auth: { user: { username: 'viewer', role: 'viewer' }, isAdmin: false, isLoggedIn: true, setAuth: () => {}, logout: () => {} } },
};

export const AlreadyFilled: Story = {
  name: '已有日期不可覆盖',
  beforeEach: () => { savedDate = '2026-04-01'; },
  play: async () => {
    const body = within(document.body);
    await expect(await body.findByText('起投时间：2026-04-01')).toBeVisible();
    await expect(body.queryByRole('button', { name: /补充起投日期/ })).not.toBeInTheDocument();
  },
};

export const SaveConflict: Story = {
  name: '保存冲突保留日期输入并提示核对',
  parameters: {
    msw: { handlers: [getHandler, http.post('/api/postal/address-changes/9901/allocations/0/start-date', () =>
      HttpResponse.json({ detail: '收件人或份数已变化，请刷新工单后重试' }, { status: 409 }))] },
  },
  play: async () => {
    const dialog = await openDateDialog();
    await userEvent.type(dialog.getByRole('textbox', { name: /起投日期/ }), '2026-04-01');
    await userEvent.tab();
    await userEvent.click(dialog.getByRole('button', { name: '保存起投日期' }));
    await waitFor(() => expect(within(document.body).getByText('收件人或份数已变化，请刷新工单后重试')).toBeVisible());
    await expect(dialog.getByRole('textbox', { name: /起投日期/ })).toHaveValue('2026-04-01');
  },
};
