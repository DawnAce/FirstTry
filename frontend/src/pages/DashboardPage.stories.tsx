import type { Meta, StoryObj } from '@storybook/react-vite'
import { withRouter, reactRouterParameters } from 'storybook-addon-remix-react-router'
import { http, HttpResponse, delay } from 'msw'
import { expect, waitFor, within } from 'storybook/test'
import Dashboard from './DashboardPage'

// 单个 GET /api/dashboard 即可驱动整页：统计卡片、近期印数表、待处理事项、趋势图。
const dashboardData = {
  recent_issues: [
    { id: 11, issue_number: 2652, year_issue_index: 18, year_issue_label: '2026年第18期', publish_date: '2026-05-12', page_count: 16, planned_page_count: 16, status: 'draft', notes: null, created_at: '2026-05-12T08:00:00Z', updated_at: '2026-05-12T09:30:00Z', print_total: 132000 },
    { id: 10, issue_number: 2651, year_issue_index: 17, year_issue_label: '2026年第17期', publish_date: '2026-05-05', page_count: 16, planned_page_count: 16, status: 'confirmed', notes: null, created_at: '2026-05-05T08:00:00Z', updated_at: '2026-05-06T09:30:00Z', print_total: 128500 },
    { id: 9, issue_number: 2650, year_issue_index: 16, year_issue_label: '2026年第16期', publish_date: '2026-04-28', page_count: 16, planned_page_count: 16, status: 'exported', notes: null, created_at: '2026-04-28T08:00:00Z', updated_at: '2026-04-29T09:30:00Z', print_total: 130200 },
    { id: 8, issue_number: 2649, year_issue_index: 15, year_issue_label: '2026年第15期', publish_date: '2026-04-21', page_count: 16, planned_page_count: 16, status: 'exported', notes: null, created_at: '2026-04-21T08:00:00Z', updated_at: '2026-04-22T09:30:00Z', print_total: 127800 },
    { id: 7, issue_number: 2648, year_issue_index: 14, year_issue_label: '2026年第14期', publish_date: '2026-04-14', page_count: 16, planned_page_count: 16, status: 'exported', notes: null, created_at: '2026-04-14T08:00:00Z', updated_at: '2026-04-15T09:30:00Z', print_total: 129100 },
  ],
  stats: { total: 42, draft: 1 },
  weekly_stats: { this_week_total: 132000, last_week_total: 128500, week_change: 3500 },
  latest_report_time: '2026-05-12T09:30:00Z',
  next_issue_number: 2653,
  next_issue_publish_date: '2026-05-19',
  next_issue: { issue_number: 2653, publish_date: '2026-05-19', page_count: 16, previous_issue_id: 11 },
  available_issues: [
    { issue_number: 2653, publish_date: '2026-05-19', page_count: 16, previous_issue_id: 11 },
    { issue_number: 2648, publish_date: '2026-04-14', page_count: 16, previous_issue_id: 7 },
  ],
}

const emptyDashboard = {
  recent_issues: [],
  stats: { total: 0, draft: 0 },
  weekly_stats: { this_week_total: 0, last_week_total: 0, week_change: 0 },
  latest_report_time: null,
  next_issue_number: null,
  next_issue_publish_date: null,
  next_issue: null,
  available_issues: [],
}

const meta = {
  title: '页面/发行计划/印数管理',
  component: Dashboard,
  tags: ['ai-generated'],
  decorators: [withRouter],
  parameters: {
    layout: 'fullscreen',
    auth: {
      user: { username: 'admin', role: 'admin' },
      isAdmin: true,
      canMutate: true,
      isLoggedIn: true,
      setAuth: () => {},
      logout: () => {},
    },
    reactRouter: reactRouterParameters({ routing: { path: '/print' } }),
    docs: {
      description: {
        component: '首页仪表盘：单个 GET /api/dashboard 驱动统计卡片、近期印数表、待处理事项与趋势图。演示 有数据 / 空 / 加载中 三态。',
      },
    },
  },
} satisfies Meta<typeof Dashboard>

export default meta
type Story = StoryObj<typeof meta>

// 有数据
export const Loaded: Story = {
  name: '已加载',
  parameters: {
    msw: { handlers: [http.get('/api/dashboard', () => HttpResponse.json(dashboardData))] },
  },
  play: async ({ canvas, userEvent }) => {
    const issueSelect = await canvas.findByRole('combobox')
    await userEvent.click(issueSelect)

    const dropdown = within(document.body)
    const nextIssue = await dropdown.findByText('第 2653 期（出刊日期：2026-05-19）', { selector: '.ant-select-item-option-content' })
    const historicalIssue = dropdown.getByText('第 2648 期（出刊日期：2026-04-14）', { selector: '.ant-select-item-option-content' })
    await waitFor(() => {
      expect(nextIssue).toBeVisible()
      expect(historicalIssue).toBeVisible()
    })

    await userEvent.click(historicalIssue)
    await expect(canvas.getByText('第 2648 期（出刊日期：2026-04-14）')).toBeVisible()
  },
}

// 全新系统：无期数、无待处理、无趋势数据
export const Empty: Story = {
  name: '空状态',
  parameters: {
    msw: { handlers: [http.get('/api/dashboard', () => HttpResponse.json(emptyDashboard))] },
  },
}

// 加载中：接口不返回，卡片与表格保持 loading
export const Loading: Story = {
  name: '加载中',
  parameters: {
    msw: {
      handlers: [
        http.get('/api/dashboard', async () => {
          await delay('infinite')
          return HttpResponse.json(dashboardData)
        }),
      ],
    },
  },
}
