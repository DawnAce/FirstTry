import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import SubscriptionGeneration from './SubscriptionGeneration';

let activated = false;
const batch = () => ({ id: 9901, year: 2026, start_month: 10, make_date: null, unit_price: null,
  status: activated ? 'ready' : 'pending_validation', active_version_id: activated ? 91 : null,
  notes: null, created_at: null, updated_at: null });
const version = () => ({ id: 91, batch_id: 9901, version_no: 1, status: activated ? 'active' : 'validation_passed',
  reason: '合成测试版本', summary_json: { total_count: 0, total_copies: 0, total_amount: '0', region_count: 0 },
  uploaded_at: null, source_files: [] });
const meta = {
  title: '页面/邮局投递/订报转投', component: SubscriptionGeneration,
  parameters: { layout: 'fullscreen',
    auth: { user: { username: 'test_admin', role: 'admin' }, isAdmin: true, isLoggedIn: true, setAuth: () => {}, logout: () => {} },
    msw: { handlers: [
      http.get('/api/subscription/batches', () => HttpResponse.json([batch()])),
      http.get('/api/subscription/batches/9901', () => HttpResponse.json({ ...batch(), versions: [version()] })),
      http.get('/api/subscription/batches/9901/artifacts', () => HttpResponse.json([])),
      http.post('/api/subscription/imports/91/activate', () => {
        activated = true;
        return HttpResponse.json({ version: version(), postal_sync: { created: 0, updated: 0, archived: 0, replaced: 0, skipped_sent: 0 } });
      }),
      http.get('/api/subscription/batches/9901/distribution-units', () => HttpResponse.json({ active_version_id: 91, snapshot: 'c'.repeat(64), total: 0, rows: [], units: [], unit_counts: [] })),
    ] },
  },
  beforeEach: () => { activated = false; },
} satisfies Meta<typeof SubscriptionGeneration>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ActivateThenReview: Story = {
  name: '设为有效后自动核对并保留入口',
  play: async () => {
    const body = within(document.body);
    await userEvent.click(await body.findByRole('button', { name: '设为有效' }));
    await userEvent.click(await body.findByRole('button', { name: /确\s*定|OK/ }));
    await waitFor(() => expect(body.getByText('本批次暂无有效投递记录')).toBeVisible());
    await userEvent.click(body.getByRole('button', { name: '保留当前分配' }));
    await userEvent.click(await body.findByRole('button', { name: '投递单位' }));
    await waitFor(() => expect(body.getByText('本批次暂无有效投递记录')).toBeVisible());
  },
};
