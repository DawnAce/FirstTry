import type { Meta, StoryObj } from '@storybook/react-vite';
import { delay, http, HttpResponse } from 'msw';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import LinkProductAliasModal from './LinkProductAliasModal';
import type { Product } from '../api/products';

const alias = '《中国经营报》全年订阅-合成开学季促销';
const product: Product = {
  id: 7, code: 'CBJ-1Y-PROMO', display_name: '中国经营报 · 全年订阅 · 促销价', aliases: ['合成旧促销名称'],
  publication: 'cbj', publication_format: 'paper', fulfillment_type: 'subscription', subscription_term: 'one_year',
  delivery_method: 'post_office', billing_type: 'paid', coverage_rule: 'term_from_month',
  coverage_start_date: null, coverage_end_date: null, list_price: '240.00', is_bundle: false, components: null,
  active: true, notes: null, created_at: '2026-01-01T00:00:00', updated_at: '2026-01-01T00:00:00',
};
const meta = {
  title: '页面/营销与交易/关联已有商品', component: LinkProductAliasModal,
  args: { alias, orderCount: 17, onClose: fn(), onLinked: fn(), onCreate: fn() },
  parameters: { layout: 'fullscreen', msw: { handlers: [http.get('/api/products', () => HttpResponse.json([product]))] } },
} satisfies Meta<typeof LinkProductAliasModal>;
export default meta;
type Story = StoryObj<typeof meta>;

const selectProduct = async (canvasElement: HTMLElement) => {
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.click(await body.findByRole('combobox', { name: '选择已有商品' }));
  await userEvent.click(await body.findByText(`${product.display_name}（${product.code}）`, { selector: '.ant-select-item-option-content' }));
  return body;
};

export const Review: Story = {
  name: '同款促销核对关联',
  play: async ({ canvasElement }) => {
    const body = await selectProduct(canvasElement);
    await waitFor(() => expect(body.getByText('¥240.00；订单保留实际成交金额')).toBeVisible());
    await expect(body.getByText('待识别名称 · 涉及 17 单')).toBeVisible();
    await expect(body.getByRole('button', { name: '保存别名并重新识别' })).toBeEnabled();
  },
};

export const SaveAlias: Story = {
  name: '确认仅追加别名',
  parameters: { msw: { handlers: [
    http.get('/api/products', () => HttpResponse.json([product])),
    http.post('/api/products/7/aliases', async ({ request }) => {
      expect(await request.json()).toEqual({ alias });
      return HttpResponse.json({ ...product, aliases: [...product.aliases!, alias] });
    }),
  ] } },
  play: async ({ canvasElement, args }) => {
    const body = await selectProduct(canvasElement);
    await userEvent.click(body.getByRole('button', { name: '保存别名并重新识别' }));
    await waitFor(() => expect(args.onLinked).toHaveBeenCalledOnce());
  },
};

export const Conflict: Story = {
  name: '别名冲突不关闭',
  parameters: { msw: { handlers: [
    http.get('/api/products', () => HttpResponse.json([product])),
    http.post('/api/products/7/aliases', () => HttpResponse.json({ detail: '该名称已关联其他商品，请核对原关联' }, { status: 409 })),
  ] } },
  play: async ({ canvasElement, args }) => {
    const body = await selectProduct(canvasElement);
    await userEvent.click(body.getByRole('button', { name: '保存别名并重新识别' }));
    await waitFor(() => expect(body.getByText('该名称已关联其他商品，请核对原关联')).toBeVisible());
    await expect(args.onLinked).not.toHaveBeenCalled();
  },
};

export const DarkCompact: Story = { ...Review, name: '暗色紧凑', globals: { theme: 'dark', density: 'compact' } };
export const Empty: Story = { name: '无启用商品', parameters: { msw: { handlers: [http.get('/api/products', () => HttpResponse.json([]))] } } };
export const Loading: Story = { name: '读取中', parameters: { msw: { handlers: [http.get('/api/products', async () => { await delay('infinite'); return HttpResponse.json([]); })] } } };
export const ReadError: Story = { name: '读取失败', parameters: { msw: { handlers: [http.get('/api/products', () => HttpResponse.json({ detail: '读取商品失败' }, { status: 500 }))] } } };
