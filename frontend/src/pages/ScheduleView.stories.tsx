import type { Meta, StoryObj } from '@storybook/react-vite'
import { http, HttpResponse, delay } from 'msw'
import { expect } from 'storybook/test'
import ScheduleView from './ScheduleView'

// 两个 GET：/api/schedule/years（年份下拉）+ /api/schedule（按年的刊期）。
const years = [2024, 2025, 2026]
const schedule = [
  { id: 1, year: 2026, issue_number: 2650, publish_date: '2026-01-06', is_suspended: false, page_count: 16, actual_page_count: 16 },
  { id: 2, year: 2026, issue_number: 2651, publish_date: '2026-01-20', is_suspended: false, page_count: 16, actual_page_count: 20 },
  { id: 3, year: 2026, issue_number: null, publish_date: '2026-02-03', is_suspended: true, page_count: null, actual_page_count: null },
  { id: 4, year: 2026, issue_number: 2652, publish_date: '2026-02-17', is_suspended: false, page_count: 16, actual_page_count: null },
]

const meta = {
  title: '页面/ScheduleView（期刊表）',
  component: ScheduleView,
  tags: ['ai-generated'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: '期刊表：GET /api/schedule/years + /api/schedule 驱动统计卡片与按月分组表格。演示 有数据 / 空 / 加载失败 / 加载中。',
      },
    },
  },
} satisfies Meta<typeof ScheduleView>

export default meta
type Story = StoryObj<typeof meta>

// 有数据：含一条休刊行与一条实际/计划版面不一致的行
export const Loaded: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/schedule/years', () => HttpResponse.json(years)),
        http.get('/api/schedule', () => HttpResponse.json(schedule)),
      ],
    },
  },
}

// 空：该年份无刊期，显示信息 Alert
export const Empty: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/schedule/years', () => HttpResponse.json([2026])),
        http.get('/api/schedule', () => HttpResponse.json([])),
      ],
    },
  },
}

// 加载失败：schedule 接口 500，retry:false 下确定性地渲染错误 Alert
export const LoadError: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/schedule/years', () => HttpResponse.json([2026])),
        http.get('/api/schedule', () => new HttpResponse(null, { status: 500 })),
      ],
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('加载刊期表数据失败，请稍后重试')).toBeVisible()
  },
}

// 加载中
export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/schedule/years', () => HttpResponse.json([2026])),
        http.get('/api/schedule', async () => { await delay('infinite'); return HttpResponse.json([]) }),
      ],
    },
  },
}
