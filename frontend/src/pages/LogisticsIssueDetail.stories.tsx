import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent } from 'storybook/test'
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
  shipping_requirement: 'tracking_required',
  physical_shipped_quantity: 0,
  no_shipment_quantity: 0,
  warehouse_stock_in_quantity: 0,
  deferred_quantity: 0,
  no_shipment_reason: null,
  warehouse_stock_in_reason: null,
  handled_quantity: 0,
  package_count: 0,
  fulfillment_status: 'pending',
  packages: [],
  order_id: null,
  order_item_id: null,
  fulfillment_target_id: null,
  source_type: 'manual',
  sync_status: 'synced',
  created_at: '2026-05-22T13:36:00',
  updated_at: '2026-05-25T09:10:00',
  ...overrides,
  actual_name: overrides.actual_name ?? null,
  actual_address: overrides.actual_address ?? null,
  actual_phone: overrides.actual_phone ?? null,
  actual_adjustment_reason: overrides.actual_adjustment_reason ?? null,
  actual_adjusted_at: overrides.actual_adjusted_at ?? null,
})

const featured = [
  makeDetail(1, {
    name: '马飞', channel: '库房留存', company: null, address: '中通库房', phone: '18515617341', quantity: 70, notes: '库房留存',
    shipping_requirement: 'no_tracking_required', physical_shipped_quantity: 70, handled_quantity: 70, fulfillment_status: 'no_tracking_required',
  }),
  makeDetail(2, {
    name: '叶剑', company: '广州日报', address: '广州市白云区增槎路1113号广州日报印务中心', phone: '13556046615', quantity: 531,
    physical_shipped_quantity: 531, handled_quantity: 531, package_count: 1, fulfillment_status: 'shipped',
    packages: [{ id: 21, carrier: '中通', tracking_no: '73592817527861', quantity: 531, shipped_at: '2026-05-25' }],
  }),
  makeDetail(3, {
    name: '肖波', company: '成都杂志铺', address: '成都市双流文星镇通关路86号A1-A4杂志铺', phone: '157191468023 / 028-85312807', quantity: 366,
    physical_shipped_quantity: 300, handled_quantity: 300, package_count: 1, fulfillment_status: 'partial',
    packages: [{ id: 31, carrier: '中通', tracking_no: '73592817528444', quantity: 300, shipped_at: '2026-05-25' }],
  }),
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
      plan_delta: 0,
      plan_is_match: true,
      plan_attributed_quantity: 0,
      plan_unexplained_delta: 0,
      plan_is_reconciled: true,
      unattributed_adjustment_quantity: 0,
    },
  })),
  http.get('/api/shipping-details/companies', () => HttpResponse.json(['广州日报', '成都杂志铺', '上海站', '广州站', '示例签约公司'])),
  http.get('/api/shipping-waybills/issues/1/summary', () => HttpResponse.json({
    issue_id: 1,
    issue_number: 2653,
    expected_quantity: 1473,
    planned_quantity: 1473,
    handled_quantity: 901,
    tracked_quantity: 831,
    no_tracking_quantity: 70,
    actual_shipped_quantity: 901,
    adjustment_quantity: 0,
    no_shipment_quantity: 0,
    warehouse_stock_in_quantity: 0,
    deferred_quantity: 0,
    twice_monthly_deferred_quantity: 0,
    month_end_deferred_quantity: 0,
    unexplained_pending_quantity: 572,
    attributed_adjustment_quantity: 0,
    unattributed_adjustment_quantity: 0,
    pending_quantity: 572,
    extra_quantity: 0,
    package_count: 2,
    pending_detail_count: 74,
    status: 'partial',
    shipment_status: 'partial',
    latest_import: null,
    adjustments: [],
    deferrals: [],
    gap_details: [],
  })),
  http.get('/api/shipping-waybills/deferrals/pending', () => HttpResponse.json([
    {
      id: 11, issue_id: 2, issue_number: 2651, shipping_detail_id: 21,
      deferral_type: 'twice_monthly_consolidation', target_issue_number: 2653,
      target_publish_date: '2026-05-25', consolidation_batch: 'second_half', quantity: 2,
      reason: '每月两次合寄', status: 'pending', fulfilled_package_id: null,
      detail_name_snapshot: '测试收件人A', detail_phone_snapshot: '13800000001',
      detail_address_snapshot: '北京市示例地址A', detail_channel_snapshot: '个人订阅',
      created_by: 1, created_at: '2026-05-11T09:00:00', fulfilled_at: null,
    },
    {
      id: 12, issue_id: 3, issue_number: 2652, shipping_detail_id: 22,
      deferral_type: 'month_end_consolidation', target_issue_number: 2653,
      target_publish_date: '2026-05-25', consolidation_batch: 'month_end', quantity: 3,
      reason: '月底合寄', status: 'pending', fulfilled_package_id: null,
      detail_name_snapshot: '测试收件人B', detail_phone_snapshot: '13800000002',
      detail_address_snapshot: '北京市示例地址B', detail_channel_snapshot: '个人订阅',
      created_by: 1, created_at: '2026-05-18T09:00:00', fulfilled_at: null,
    },
    {
      id: 13, issue_id: 1, issue_number: 2600, shipping_detail_id: null,
      deferral_type: 'month_end_consolidation', target_issue_number: null,
      target_publish_date: null, consolidation_batch: null, quantity: 5,
      reason: '历史待办', status: 'pending', fulfilled_package_id: null,
      detail_name_snapshot: '历史收件人', detail_phone_snapshot: null,
      detail_address_snapshot: null, detail_channel_snapshot: '个人订阅',
      created_by: 1, created_at: '2025-12-01T09:00:00', fulfilled_at: null,
    },
  ])),
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
    auth: { user: { username: 'admin', role: 'admin' }, isAdmin: true, canMutate: true, isLoggedIn: true, setAuth: () => {}, logout: () => {} },
    reactRouter: reactRouterParameters({
      routing: { path: '/logistics/issues/:id' },
      location: { pathParams: { id: '1' } },
    }),
    msw: { handlers },
  },
} satisfies Meta<typeof LogisticsIssueDetail>

export default meta
type Story = StoryObj<typeof meta>

export const ConfirmedWithChanges: Story = {
  name: '当前计划一致（确认后有变更）',
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('计划已对平')).toBeVisible()
    await expect(await canvas.findByText('确认报数')).toBeVisible()
    await expect(await canvas.findByText('当前计划已与确认报数对平，以下保留确认时快照差异。')).toBeVisible()
  },
}

export const ActualWithPending: Story = {
  name: '实际发货仍有待处理',
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole('tab', { name: /实际发货/ }))
    await expect(await canvas.findByText('本期待完成合寄 2条 / 5份')).toBeVisible()
    await expect(await canvas.findByRole('button', { name: /处理合寄发货/ })).toBeVisible()
    const continueButton = await canvas.findByRole('button', { name: '继续处理' })
    await expect(getComputedStyle(continueButton.lastElementChild!).color).toBe('rgb(29, 29, 31)')
  },
}

export const LoadFailure: Story = {
  name: '接口失败（不得显示为空数据）',
  parameters: {
    msw: {
      handlers: [
        handlers[0],
        handlers[1],
        handlers[2],
        http.get('/api/shipping-waybills/issues/1/summary', () => HttpResponse.json(
          { detail: '数据库结构未更新，请管理员执行 alembic upgrade head' },
          { status: 503 },
        )),
        http.get('/api/shipping-details', () => HttpResponse.json(
          { detail: '数据库结构未更新，请管理员执行 alembic upgrade head' },
          { status: 503 },
        )),
        handlers[4],
      ],
    },
  },
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole('tab', { name: /实际发货/ }))
    const retryButton = await canvas.findByRole('button', { name: /重新加载/ })
    await expect(getComputedStyle(retryButton.lastElementChild!).color).toBe('rgb(29, 29, 31)')
  },
}
