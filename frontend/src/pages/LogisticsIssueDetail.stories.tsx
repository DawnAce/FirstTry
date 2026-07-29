import type { Meta, StoryObj } from '@storybook/react-vite'
import { http, HttpResponse } from 'msw'
import { reactRouterParameters, withRouter } from 'storybook-addon-remix-react-router'
import type { ShippingDetail } from '../api/shippingDetails'
import LogisticsIssueDetail from './LogisticsIssueDetail'

const issue = {
  id: 1,
  issue_number: 2653,
  year_issue_index: 19,
  year_issue_label: '十九',
  publish_date: '2026-05-25',
  page_count: 16,
  planned_page_count: 16,
  status: 'confirmed',
  notes: null,
  created_at: '2026-05-22T13:36:00',
  updated_at: '2026-05-25T09:10:00',
}

const makeDetail = (id: number, overrides: Partial<ShippingDetail>): ShippingDetail => ({
  id,
  issue_number: 2653,
  sheet_name: 'ZTO-MF',
  channel: '渠道订阅',
  sub_channel: null,
  transport: '中通物流',
  frequency: '周',
  status: '正常',
  name: `测试收件人${id}`,
  address: `北京市朝阳区示例路${id}号`,
  phone: `1380000${String(id).padStart(4, '0')}`,
  quantity: id <= 24 ? 7 : 6,
  deadline: '长期',
  notes: null,
  extra_info: null,
  station_name: null,
  station_hall: null,
  contact_person: null,
  seq_number: id,
  period_count: null,
  confirmation: null,
  company: '示例签约公司',
  shipped_at: null,
  shipped_quantity: null,
  tracking_no: null,
  order_id: null,
  order_item_id: null,
  fulfillment_target_id: null,
  source_type: 'manual',
  sync_status: 'synced',
  created_at: '2026-05-22T13:36:00',
  updated_at: '2026-05-25T09:10:00',
  ...overrides,
})

const featured = [
  makeDetail(1, { name: '马飞', channel: '库房留存', company: null, address: '中通库房', phone: '18515617341', quantity: 70, notes: '库房留存' }),
  makeDetail(2, { name: '叶剑', company: '广州日报', address: '广州市白云区增槎路1113号广州日报印务中心', phone: '13556046615', quantity: 531 }),
  makeDetail(3, { name: '肖波', company: '成都杂志铺', address: '成都市双流文星镇通关路86号A1-A4杂志铺', phone: '157191468023 / 028-85312807', quantity: 366 }),
  makeDetail(4, { name: '李广', channel: '记者站', company: '上海站', address: '上海市徐汇区漕溪北路737弄2号楼2106', phone: '13564653181', quantity: 20, notes: '记者站' }),
  makeDetail(5, { name: '纪玉文', channel: '记者站', company: '广州站', address: '广州市越秀区寺右新马路111-115号五羊新城广场', phone: '13661331923', quantity: 30, notes: '记者站' }),
]

const filler = Array.from({ length: 72 }, (_, index) => makeDetail(index + 6, { quantity: index < 24 ? 7 : 6 }))
const records = [...featured, ...filler]

const handlers = [
  http.get('/api/issues/1', () => HttpResponse.json(issue)),
  http.get('/api/issues/1/report', () => HttpResponse.json({
    issue_id: 1,
    issue_number: 2653,
    entries: [],
    total: 1473,
    destination_summary: [{ destination: '中通物流公司', total: 1473 }],
    shipping_check: { is_match: true, report_zt_total: 1473, shipping_total: 1473, delta: 0 },
    confirmation_summary: {
      confirmed_report_total: 1473,
      confirmed_shipping_total: 1423,
      confirmed_delta: 50,
      confirmed_is_match: false,
      current_shipping_total: 1473,
      current_delta: 0,
      current_is_match: true,
      has_shipping_drift: true,
    },
  })),
  http.get('/api/shipping-details/companies', () => HttpResponse.json(['广州日报', '成都杂志铺', '上海站', '广州站', '示例签约公司'])),
  http.get('/api/shipping-details', ({ request }) => {
    const params = new URL(request.url).searchParams
    const search = params.get('search')?.toLowerCase()
    const companies = params.get('company')?.split(',')
    const filtered = records.filter((record) => (
      (!params.get('channel') || record.channel === params.get('channel'))
      && (!params.get('status') || record.status === params.get('status'))
      && (!companies || companies.includes(record.company ?? ''))
      && (!search || [record.name, record.address, record.phone].some((value) => value?.toLowerCase().includes(search)))
    ))
    return HttpResponse.json(filtered)
  }),
]

const meta = {
  title: '页面/发行履约/快递管理/期数详情',
  component: LogisticsIssueDetail,
  decorators: [withRouter],
  parameters: {
    auth: { user: { username: 'admin', role: 'admin' }, isAdmin: true, isLoggedIn: true, setAuth: () => {}, logout: () => {} },
    reactRouter: reactRouterParameters({
      routing: { path: '/logistics/issues/:id' },
      location: { pathParams: { id: '1' } },
    }),
    msw: { handlers },
  },
} satisfies Meta<typeof LogisticsIssueDetail>

export default meta
type Story = StoryObj<typeof meta>

export const ConfirmedWithChanges: Story = { name: '已确认（确认后有变更）' }
