import type { Meta, StoryObj } from '@storybook/react-vite'
import { http, HttpResponse } from 'msw'
import { expect } from 'storybook/test'
import ScheduleImport from './ScheduleImport'

// 挂载时仅拉取上传历史；上传卡片由 auth.isAdmin 控制是否显示。
const uploads = [
  { id: 1, year: 2026, original_filename: '2026年度刊期表.pdf', status: 'committed', summary_json: { total_rows: 52, published_count: 50, suspended_count: 2, first_issue_number: 2635, last_issue_number: 2684, page_count: 16, remarks: null }, error_json: null, uploaded_by: 'admin', created_at: '2026-01-05T09:30:00Z', committed_at: '2026-01-05T09:35:00Z' },
  { id: 2, year: 2026, original_filename: '2026修订版.pdf', status: 'previewed', summary_json: { total_rows: 52, published_count: 51, suspended_count: 1, first_issue_number: 2635, last_issue_number: 2685, page_count: 16, remarks: null }, error_json: null, uploaded_by: 'editor', created_at: '2026-02-10T14:20:00Z', committed_at: null },
]

const adminAuth = {
  user: { id: 1, username: 'admin', role: 'admin' },
  isAdmin: true,
  isLoggedIn: true,
  setAuth: () => {},
  logout: () => {},
}

const meta = {
  title: '页面/ScheduleImport（导入期刊表）',
  component: ScheduleImport,
  tags: ['ai-generated'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: '导入期刊表：挂载时 GET /api/schedule/uploads 拉上传记录；上传 Dragger 由 isAdmin 控制。演示 管理员 / 非管理员 / 空 / 加载失败。',
      },
    },
  },
} satisfies Meta<typeof ScheduleImport>

export default meta
type Story = StoryObj<typeof meta>

// 管理员：显示上传卡片 + 上传记录表
export const AdminLoaded: Story = {
  parameters: {
    auth: adminAuth,
    msw: { handlers: [http.get('/api/schedule/uploads', () => HttpResponse.json(uploads))] },
  },
}

// 非管理员（默认登出态）：上传卡片收起为警告 Alert
export const NonAdmin: Story = {
  parameters: {
    msw: { handlers: [http.get('/api/schedule/uploads', () => HttpResponse.json([]))] },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('仅管理员可上传刊期 PDF')).toBeVisible()
  },
}

// 管理员但无上传记录：表格空态
export const UploadsEmpty: Story = {
  parameters: {
    auth: adminAuth,
    msw: { handlers: [http.get('/api/schedule/uploads', () => HttpResponse.json([]))] },
  },
}

// 上传记录加载失败：错误 Alert（retry:false 确定性）
export const UploadsError: Story = {
  parameters: {
    auth: adminAuth,
    msw: { handlers: [http.get('/api/schedule/uploads', () => new HttpResponse(null, { status: 500 }))] },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('加载上传记录失败，请稍后重试')).toBeVisible()
  },
}
