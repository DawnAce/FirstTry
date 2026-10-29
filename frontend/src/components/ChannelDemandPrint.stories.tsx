import type { Meta, StoryObj } from '@storybook/react-vite';
import { withRouter, reactRouterParameters } from 'storybook-addon-remix-react-router';
import { http, HttpResponse } from 'msw';
import { expect, userEvent, within, fn, waitFor } from 'storybook/test';
import ChannelDemandPrint from './ChannelDemandPrint';
import type { DemandPrintPreview } from '../api/channelDemands';

const preview: DemandPrintPreview = {
  issue_number: 2680, token: 'a'.repeat(64), can_apply: true,
  rows: [{ category: 'chengdu', sub_category: '成都杂志铺', quantity: 100, current_quantity: 80,
    fingerprint: 'b'.repeat(64), adopted: false, errors: [], sources: [{ demand_id: 101, version: 2, display_name: '合成机构', quantity: 100, review_status: 'confirmed' }] }],
};
const meta = {
  title: '业务组件/机构需求印数采用', component: ChannelDemandPrint, decorators: [withRouter],
  args: { issueId: 1, disabled: false, beforePreview: fn(async () => {}), onApplied: fn(async () => {}) },
  parameters: { reactRouter: reactRouterParameters({ routing: { path: '/report/1' } }), msw: { handlers: [
    http.get('/api/channel-demands/print/1', () => HttpResponse.json(preview)),
    http.post('/api/channel-demands/print/1/apply', async ({ request }) => {
      expect(await request.json()).toEqual({ token: preview.token });
      return HttpResponse.json({ ...preview, rows: [{ ...preview.rows[0], adopted: true, current_quantity: 100 }] });
    }),
  ] } },
} satisfies Meta<typeof ChannelDemandPrint>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Adopt: Story = {
  name: '先保存编辑再预览，采用替换并刷新',
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement); const body = within(canvasElement.ownerDocument.body);
    await canvas.findByText('1 个分项可核对');
    await userEvent.click(canvas.getByRole('button', { name: '预览差异并采用' }));
    expect(args.beforePreview).toHaveBeenCalledOnce();
    const dialog = within(await body.findByRole('dialog'));
    await waitFor(() => expect(dialog.getByRole('cell', { name: '20' })).toBeVisible());
    await userEvent.click(dialog.getByRole('button', { name: '按需求替换分项印数' }));
    await waitFor(() => expect(args.onApplied).toHaveBeenCalledOnce());
  },
};
export const Pending: Story = {
  name: '待确认及旧来源冲突阻断采用',
  parameters: { msw: { handlers: [http.get('/api/channel-demands/print/1', () => HttpResponse.json({ ...preview, can_apply: false, rows: [{ ...preview.rows[0], errors: ['渠道数量仍待确认', '已有原始报数来源，不能重复计入'] }] }))] } },
  play: async ({ canvasElement }) => { const canvas = within(canvasElement); const body = within(canvasElement.ownerDocument.body); await canvas.findByText('1 个分项可核对'); await userEvent.click(canvas.getByRole('button', { name: '预览差异并采用' })); const dialog = within(await body.findByRole('dialog')); await waitFor(() => expect(dialog.getByText('渠道数量仍待确认')).toBeVisible()); expect(dialog.getByRole('button', { name: '按需求替换分项印数' })).toBeDisabled(); },
};
export const Locked: Story = {
  name: '锁定刊期不能采用', args: { disabled: true },
  play: async ({ canvasElement }) => { expect(await within(canvasElement).findByRole('button', { name: '预览差异并采用' })).toBeDisabled(); },
};
