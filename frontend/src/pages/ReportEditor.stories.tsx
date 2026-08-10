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

const sourceSummary = {
  issue_number: 2654,
  document_count: 2,
  documents: [
    {
      id: 31,
      channel: 'chengdu',
      document_type: 'monthly',
      original_filename: '2026年6月成都杂志铺报数.jpg',
      display_name: '202606_成都杂志铺_月度报数.jpg',
      mime_type: 'image/jpeg',
      size: 185420,
      sha256: 'a'.repeat(64),
      source_date: '2026-05-17',
      upload_issue_number: 2654,
      file_available: true,
      extraction_status: 'confirmed',
      extraction_json: null,
      uploaded_by: 'admin',
      created_at: '2026-05-17T10:30:00',
      updated_at: '2026-05-17T10:35:00',
      items: [{
        id: 51, document_id: 31, issue_number: 2654, item_kind: 'base', category: 'chengdu',
        sub_category: '成都杂志铺', source_label: '2026年6月第1期', source_quantity: 366,
        applied_quantity: 366, source_status: 'confirmed', source_action: 'base', applied_phase: 'pre_confirmation',
        print_delta: 366, effect_status: 'active', supersedes_item_id: null, adjustment_kind: null, settlement_delta: 0,
        shipping_delta: 0, shipped_quantity: 0, tracking_no: null, shipped_at: null, notes: null,
        confirmed_at: '2026-05-17T10:35:00', created_at: '2026-05-17T10:30:00',
      }],
    },
    {
      id: 32,
      channel: 'chengdu',
      document_type: 'adjustment',
      original_filename: '成都杂志铺跨月补发.jpg',
      display_name: '20260717_成都杂志铺_补发调整_3期共6份.jpg',
      mime_type: 'image/jpeg',
      size: 93420,
      sha256: 'b'.repeat(64),
      source_date: '2026-07-17',
      upload_issue_number: 2654,
      file_available: true,
      extraction_status: 'confirmed',
      extraction_json: null,
      uploaded_by: 'admin',
      created_at: '2026-07-17T15:40:00',
      updated_at: '2026-07-17T15:44:00',
      items: [{
        id: 52, document_id: 32, issue_number: 2654, item_kind: 'adjustment', category: 'chengdu',
        sub_category: '成都杂志铺', source_label: '2026年6月第1期补发', source_quantity: 4,
        applied_quantity: null, source_status: 'confirmed', source_action: 'postpress_addition', applied_phase: 'post_confirmation',
        print_delta: 0, effect_status: 'active', supersedes_item_id: null, adjustment_kind: 'billable_addition', settlement_delta: 4,
        shipping_delta: 4, shipped_quantity: 1, tracking_no: null, shipped_at: null,
        notes: '追加订数', confirmed_at: '2026-07-17T15:44:00', created_at: '2026-07-17T15:40:00',
      }],
    },
  ],
  channels: [
    { channel: 'postal', document_count: 0, base_quantity: 6815, settlement_delta: 0, settlement_total: 6815, shipping_delta: 0, shipped_quantity: 0, pending_shipping: 0, pending_count: 0 },
    { channel: 'retail', document_count: 0, base_quantity: 1052, settlement_delta: 0, settlement_total: 1052, shipping_delta: 0, shipped_quantity: 0, pending_shipping: 0, pending_count: 0 },
    { channel: 'guangzhou', document_count: 0, base_quantity: 531, settlement_delta: 0, settlement_total: 531, shipping_delta: 0, shipped_quantity: 0, pending_shipping: 0, pending_count: 0 },
    { channel: 'chengdu', document_count: 2, base_quantity: 366, settlement_delta: 4, settlement_total: 370, shipping_delta: 4, shipped_quantity: 1, pending_shipping: 3, pending_count: 0 },
  ],
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
  http.get('/api/report-sources/issues/1', () => HttpResponse.json(sourceSummary)),
  http.delete('/api/report-sources/:documentId', () => new HttpResponse(null, { status: 204 })),
  http.patch('/api/report-sources/items/:itemId/shipping', async ({ request }) => HttpResponse.json(await request.json())),
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
    await expect(canvas.getByText('完整 22 项')).toBeVisible()
    await expect(canvas.getByText('数据来源与调整')).toBeVisible()
    await expect(await canvas.findByText('后续 +4')).toBeVisible()
    await expect(canvas.getByText('202606_成都杂志铺_月度报数.jpg')).toBeVisible()
    await expect(canvas.getByText('20260717_成都杂志铺_补发调整_3期共6份.jpg')).toBeVisible()
    await expect(canvas.getByText('追加订数')).toBeVisible()
  },
}
