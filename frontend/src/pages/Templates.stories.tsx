import type { Meta, StoryObj } from '@storybook/react-vite'
import { http, HttpResponse, delay } from 'msw'
import Templates from './Templates'

// getTemplates 返回 Template[]：含固定项与变动项（is_variable）。
const templates = [
  { id: 1, category: '北京邮发', sub_category: '外埠', display_name: '外埠', default_value: 1200, is_variable: false, sort_order: 1, excel_sheet: '报数', excel_cell: 'B2' },
  { id: 2, category: '北京邮发', sub_category: '本埠', display_name: '本埠', default_value: 800, is_variable: false, sort_order: 2, excel_sheet: '报数', excel_cell: 'B3' },
  { id: 3, category: '零售', sub_category: '报刊亭', display_name: '报刊亭零售', default_value: 300, is_variable: true, sort_order: 3, excel_sheet: null, excel_cell: null },
  { id: 4, category: '自用', sub_category: '临时加印', display_name: '临时加印', default_value: 0, is_variable: true, sort_order: 4, excel_sheet: null, excel_cell: null },
]

const meta = {
  title: '页面/Templates（报数模板）',
  component: Templates,
  tags: ['ai-generated'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: '报数模板：单个 GET /api/templates 驱动表格，含创建/编辑 Modal。演示 有数据 / 空 / 加载中。',
      },
    },
  },
} satisfies Meta<typeof Templates>

export default meta
type Story = StoryObj<typeof meta>

// 有数据
export const Loaded: Story = {
  parameters: {
    msw: { handlers: [http.get('/api/templates', () => HttpResponse.json(templates))] },
  },
}

// 空列表
export const Empty: Story = {
  parameters: {
    msw: { handlers: [http.get('/api/templates', () => HttpResponse.json([]))] },
  },
}

// 加载中
export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/templates', async () => {
          await delay('infinite')
          return HttpResponse.json([])
        }),
      ],
    },
  },
}
