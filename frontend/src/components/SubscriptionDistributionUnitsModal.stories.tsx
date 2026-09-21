import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { delay, http, HttpResponse } from 'msw';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import type { BatchDeliveryUnit, BatchDeliveryUnitsUpdate } from '../api/subscription';
import SubscriptionDistributionUnitsModal from './SubscriptionDistributionUnitsModal';

const rows: BatchDeliveryUnit[] = Array.from({ length: 55 }, (_, index) => ({
  id: index + 1, year: 2026, delivery_no: String(index + 1), recipient_name: `测试读者${index + 1}`,
  recipient_province: '广东省', recipient_city: '测试市', recipient_district: '测试区', copies: 1,
  distribution_unit_id: 2, distribution_unit_name: '广东集订分送',
}));
const units = [{ id: 1, name: '北京集订分送' }, { id: 2, name: '广东集订分送' }];
const path = '/api/subscription/batches/9901/distribution-units';
let saved: BatchDeliveryUnitsUpdate | null = null;
const getHandler = http.get(path, ({ request }) => {
  const page = Number(new URL(request.url).searchParams.get('page') || 1);
  return HttpResponse.json({ active_version_id: 91, snapshot: 'a'.repeat(64), total: rows.length,
    rows: rows.slice((page - 1) * 50, page * 50), units,
    unit_counts: [{ id: 2, name: '广东集订分送', count: rows.length }] });
});
const saveHandler = http.put(path, async ({ request }) => {
  saved = await request.json() as BatchDeliveryUnitsUpdate;
  return HttpResponse.json({ changed: saved.all_distribution_unit_id ? 55 - saved.updates.length : saved.updates.length });
});

function Demo() {
  const [open, setOpen] = useState(true);
  return open ? <SubscriptionDistributionUnitsModal batchId={9901} batchLabel="2026年10月批次" onClose={() => setOpen(false)} />
    : <button onClick={() => setOpen(true)}>重新打开投递单位</button>;
}

const meta = {
  title: '页面/邮局投递/批次投递单位', component: SubscriptionDistributionUnitsModal,
  parameters: { layout: 'fullscreen', msw: { handlers: [getHandler, saveHandler] } },
  args: { batchId: 9901, batchLabel: '2026年10月批次', onClose: () => {} },
  render: () => <Demo />,
  beforeEach: () => { saved = null; },
} satisfies Meta<typeof SubscriptionDistributionUnitsModal>;
export default meta;
type Story = StoryObj<typeof meta>;

async function chooseUnit(label: string, unit: string) {
  const body = within(document.body);
  const select = await body.findByRole('combobox', { name: label });
  await userEvent.click(select);
  await userEvent.type(select, unit);
  await waitFor(() => expect(document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content')).toHaveTextContent(unit));
  const option = body.getAllByText(unit).find((element) => element.classList.contains('ant-select-item-option-content')) as HTMLElement;
  await userEvent.click(option);
}

async function stageAll() {
  const body = within(document.body);
  await waitFor(() => expect(body.getByText('本批次 55 条')).toBeVisible());
  await userEvent.click(body.getByText('本批次全部 55 条（跨页）'));
  await chooseUnit('批量投递单位', '北京集订分送');
  await userEvent.click(body.getByRole('button', { name: '应用到待调整列表' }));
  await expect(body.getByText('修改尚未保存。共 55 条将变更，点击“保存调整”核对明细后确认。')).toBeVisible();
}

export const Review: Story = {
  name: '核对窗口',
  play: async () => { await waitFor(() => expect(within(document.body).getByText('本批次 55 条')).toBeVisible()); },
};
export const BulkWithException: Story = {
  name: '全批次跨页修改并保留一个例外',
  play: async () => {
    const body = within(document.body);
    await stageAll();
    await userEvent.click(body.getByTitle('2'));
    await chooseUnit('测试读者55的投递单位', '广东集订分送');
    await expect(body.getByText('修改尚未保存。共 54 条将变更，点击“保存调整”核对明细后确认。')).toBeVisible();
    await userEvent.click(body.getByRole('button', { name: '保存调整' }));
    await waitFor(() => expect(body.getByText('2026年10月批次 · 共修改 54 条投递记录')).toBeVisible());
    await expect(saved).toBeNull();
    await userEvent.click(body.getByRole('button', { name: '确认保存 54 条' }));
    await waitFor(() => expect(saved).toMatchObject({ active_version_id: 91, all_distribution_unit_id: 1,
      updates: [{ delivery_id: 55, distribution_unit_id: 2 }] }));
    await expect(await body.findByRole('button', { name: '重新打开投递单位' })).toBeVisible();
  },
};
export const SelectedAcrossPages: Story = {
  name: '跨页勾选部分记录',
  play: async () => {
    const body = within(document.body);
    await waitFor(() => expect(body.getByText('本批次 55 条')).toBeVisible());
    const first = body.getByText('测试读者1').closest('tr') as HTMLElement;
    await userEvent.click(within(first).getByRole('checkbox'));
    await userEvent.click(body.getByTitle('2'));
    const last = (await body.findByText('测试读者55')).closest('tr') as HTMLElement;
    await userEvent.click(within(last).getByRole('checkbox'));
    await expect(body.getByRole('radio', { name: '已勾选 2 条' })).toBeChecked();
    await chooseUnit('批量投递单位', '北京集订分送');
    await userEvent.click(body.getByRole('button', { name: '应用到待调整列表' }));
    await userEvent.click(body.getByRole('button', { name: '保存调整' }));
    await userEvent.click(await body.findByRole('button', { name: '确认保存 2 条' }));
    await waitFor(() => expect(saved).toMatchObject({ all_distribution_unit_id: null,
      updates: [{ delivery_id: 1, distribution_unit_id: 1 }, { delivery_id: 55, distribution_unit_id: 1 }] }));
  },
};
export const KeepAllocation: Story = {
  name: '关闭保留当前分配',
  play: async () => {
    const body = within(document.body);
    await waitFor(() => expect(body.getByText('本批次 55 条')).toBeVisible());
    await expect(body.getByRole('button', { name: '保存调整' })).toBeDisabled();
    await userEvent.click(body.getByRole('button', { name: '保留当前分配' }));
    await expect(await body.findByRole('button', { name: '重新打开投递单位' })).toBeVisible();
    await expect(saved).toBeNull();
  },
};
export const Conflict: Story = {
  name: '并发变更阻止覆盖',
  parameters: { msw: { handlers: [getHandler, http.put(path, () => HttpResponse.json({ detail: '批次版本或投递记录已变化，请重新打开投递单位窗口核对后保存' }, { status: 409 }))] } },
  play: async () => {
    const body = within(document.body);
    await stageAll();
    await userEvent.click(body.getByRole('button', { name: '保存调整' }));
    await userEvent.click(await body.findByRole('button', { name: '确认保存 55 条' }));
    await expect(await body.findByRole('button', { name: '重新读取' })).toBeVisible();
    await expect(body.getByRole('button', { name: '保存调整' })).toBeDisabled();
  },
};
export const EmptyBatch: Story = {
  name: '空批次', parameters: { msw: { handlers: [http.get(path, () => HttpResponse.json({
    active_version_id: 91, snapshot: 'b'.repeat(64), total: 0, rows: [], units, unit_counts: [],
  }))] } },
  play: async () => { await waitFor(() => expect(within(document.body).getByText('本批次暂无有效投递记录')).toBeVisible()); },
};
export const Loading: Story = {
  name: '加载中', parameters: { msw: { handlers: [http.get(path, async () => { await delay('infinite'); })] } },
};
export const LoadError: Story = {
  name: '加载失败可重试', parameters: { msw: { handlers: [http.get(path, () => HttpResponse.json({ detail: '读取失败，请重试' }, { status: 503 }))] } },
  play: async () => { await waitFor(() => expect(within(document.body).getByRole('button', { name: /重\s*试/ })).toBeVisible()); },
};
export const DarkCompact: Story = { ...Review, name: '暗色紧凑', globals: { theme: 'dark', density: 'compact' } };
export const LightCompact: Story = { ...Review, name: '亮色紧凑', globals: { theme: 'light', density: 'compact' } };
export const DarkComfortable: Story = { ...Review, name: '暗色舒适', globals: { theme: 'dark', density: 'comfortable' } };
