import type { Meta, StoryObj } from '@storybook/react-vite'
import { http, HttpResponse } from 'msw'
import { expect, within, waitFor } from 'storybook/test'
import ProductCatalog from './ProductCatalog'

// listProducts 返回 Product[]：一个启用的单品 + 一个停用的套餐（带 components）。
const products = [
  { id: 1, code: 'CBJ-1Y-POST-WK', display_name: '中国经营报 · 全年订阅 · 邮局周投', aliases: ['中国经营报全年', 'CBJ-618促销活动'], publication: 'cbj', publication_format: 'paper', fulfillment_type: 'subscription', subscription_term: 'one_year', delivery_method: 'post_office', billing_type: 'paid', coverage_rule: 'term_from_month', coverage_start_date: null, coverage_end_date: null, list_price: '360.00', is_bundle: false, components: null, active: true, notes: null, created_at: '2026-01-02T08:00:00Z', updated_at: '2026-01-02T08:00:00Z' },
  { id: 2, code: 'BUNDLE-CBJ-BS-1Y', display_name: '中国经营报+商学院 · 全年套餐', aliases: null, publication: null, publication_format: 'paper', fulfillment_type: 'subscription', subscription_term: 'one_year', delivery_method: 'zto_mf', billing_type: 'bundle_gift', coverage_rule: 'term_from_month', coverage_start_date: null, coverage_end_date: null, list_price: '520.00', is_bundle: true, components: [{ publication: 'cbj', delivery_method: 'zto_mf', remainder: false }, { publication: 'business_school', delivery_method: null, remainder: true }], active: false, notes: '已下架的旧套餐', created_at: '2025-06-01T08:00:00Z', updated_at: '2026-03-01T08:00:00Z' },
]

const meta = {
  title: '页面/ProductCatalog（商品库）',
  component: ProductCatalog,
  tags: ['ai-generated'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: '商品库：单个 GET /api/products 驱动表格，含创建/编辑 Modal。演示 有数据 / 空 / 打开新增弹窗。',
      },
    },
  },
} satisfies Meta<typeof ProductCatalog>

export default meta
type Story = StoryObj<typeof meta>

// 有数据：表格渲染商品（编码唯一，作为异步到达断言锚点）
export const Loaded: Story = {
  parameters: {
    msw: { handlers: [http.get('/api/products', () => HttpResponse.json(products))] },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('CBJ-1Y-POST-WK')).toBeVisible()
  },
}

// 空列表
export const Empty: Story = {
  parameters: {
    msw: { handlers: [http.get('/api/products', () => HttpResponse.json([]))] },
  },
}

// 交互：点击「新增商品」打开 Modal（portal 渲染在 document.body）
export const CreateModal: Story = {
  parameters: {
    msw: { handlers: [http.get('/api/products', () => HttpResponse.json(products))] },
  },
  play: async ({ canvas, userEvent }) => {
    // 按钮带 PlusOutlined 图标，无障碍名含图标 label（"plus 新增商品"），故用子串匹配
    await userEvent.click(await canvas.findByRole('button', { name: /新增商品/ }))
    // Modal 在 document.body 的 portal 中；等 zoom 入场动画结束后才算可见
    const dialog = await within(document.body).findByRole('dialog')
    await waitFor(() => expect(dialog).toBeVisible())
  },
}
