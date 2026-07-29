import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import { http, HttpResponse } from 'msw'
import { reactRouterParameters, withRouter } from 'storybook-addon-remix-react-router'
import ReportEditor from './ReportEditor'

const issue = {
  id: 1,
  issue_number: 2654,
  year_issue_index: 20,
  year_issue_label: '二十',
  publish_date: '2026-06-01',
  page_count: 24,
  planned_page_count: 24,
  status: 'draft',
  notes: null,
  created_at: '2026-05-27T14:10:00',
  updated_at: '2026-05-27T15:26:00',
}

const rawEntries = [
  ['postal', '外埠', 5597], ['postal', '本市', 1218],
  ['retail', '东部', 460], ['retail', '西部', 592],
  ['guangzhou', '零售', 500], ['guangzhou', '订阅', 31],
  ['chengdu', '成都杂志铺', 366], ['guotumao', '国图贸', 1],
  ['social_use', '临时加印', 50], ['social_use', '临时加印_自留', 50],
  ['social_use', '营报传媒_收发室', 29], ['social_use', '营报传媒_读者', 50], ['social_use', '营报传媒_备用报', 79],
  ['social_use', '中经传媒智库', 3], ['social_use', '新闻中心', 45], ['social_use', '行政', 4],
  ['social_use', '财经中心', 9], ['social_use', '产经中心', 5], ['social_use', '出版中心', 10],
  ['social_use', '品牌中心', 5], ['social_use', '经营网', 7], ['social_use', '法务', 2],
  ['social_use', '社科院、工经所', 64], ['social_use', '财务', 1], ['social_use', '库房', 10],
  ['social_use', '上海站用', 20], ['social_use', '广东站用', 30], ['social_use', '成都站用', 2], ['social_use', '西安站用', 10],
  ['social_use', '营报传媒_上犹', 30], ['social_use', '高铁展示', 110],
  ['binding', '合订本（印厂留存）', 15],
] as const

const entries = rawEntries.map(([category, sub_category, value], index) => ({
  id: index + 1,
  category,
  sub_category,
  value,
  is_variable: category === 'social_use',
  destination: null,
}))

const report = {
  issue_id: 1,
  issue_number: 2654,
  entries,
  total: 9355,
  destination_summary: [
    { destination: '印厂留存', total: 15 },
    { destination: '中通物流公司', total: 1473 },
    { destination: '北京市报刊发行局', total: 6815 },
    { destination: '北京市报刊零售公司', total: 1052 },
  ],
  confirmation_summary: null,
  shipping_check: { is_match: false, report_zt_total: 1473, shipping_total: 0, delta: 1473 },
}

const handlers = [
  http.get('/api/issues/1', () => HttpResponse.json(issue)),
  http.patch('/api/issues/1', async ({ request }) => HttpResponse.json({ ...issue, ...await request.json() as object })),
  http.get('/api/issues/1/report', () => HttpResponse.json(report)),
  http.put('/api/issues/1/report', () => HttpResponse.json(report)),
  http.post('/api/issues/1/report/confirm', () => HttpResponse.json({ message: '确认成功', issue_number: 2654 })),
  http.get('/api/issues/1/report/revisions', () => HttpResponse.json([])),
  http.get('/api/issues/1/report/temp-details', () => HttpResponse.json([])),
  http.put('/api/issues/1/report/temp-details', async ({ request }) => HttpResponse.json(await request.json())),
]

const meta = {
  title: '页面/发行计划/印数管理/报数编辑',
  component: ReportEditor,
  decorators: [withRouter],
  parameters: {
    auth: { user: { username: 'admin', role: 'admin' }, isAdmin: true, isLoggedIn: true, setAuth: () => {}, logout: () => {} },
    reactRouter: reactRouterParameters({
      routing: { path: '/report/:issueId' },
      location: { pathParams: { issueId: '1' } },
    }),
    msw: { handlers },
  },
} satisfies Meta<typeof ReportEditor>

export default meta
type Story = StoryObj<typeof meta>

export const Draft: Story = {
  name: '待确认（完整数据）',
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('2026年《中国经营报》第2654期（第二十期）')).toBeVisible()
    await expect(canvas.getByRole('spinbutton', { name: '实际版数' })).toHaveValue('24')
    await expect(canvas.getByText('完整 22 项')).toBeVisible()
  },
}
