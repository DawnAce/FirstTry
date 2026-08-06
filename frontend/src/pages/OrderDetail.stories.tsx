import type { Meta, StoryObj } from '@storybook/react-vite'
import { withRouter, reactRouterParameters } from 'storybook-addon-remix-react-router'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import type { OrderEventOut, OrderOut } from '../api/orders'
import OrderDetail from './OrderDetail'

const order: OrderOut = {
  id: 96,
  order_code: 'ORD-2026-000001',
  external_order_no: '2026071622202732603212',
  order_date: '2026-07-20',
  entry_method: 'manual',
  source_platform: '微信小程序',
  source_store: 'CBJ+',
  campaign: null,
  payer_name: '宋女士',
  payer_contact: '13800008821',
  payment_method: 'wechat',
  payment_collector: '卢娅丽',
  total_amount: '240.00',
  paid_amount: '240.00',
  invoice_required: true,
  invoice_title: '悦心堂（济南）医养有限公司历下分公司',
  invoice_tax_no: '91370102MAE3DH6U68',
  invoice_recipient_email: '380903801@qq.com',
  invoice_state: 'issued',
  normal_invoiced_amount: '240.00',
  remaining_invoice_amount: '0.00',
  needs_red_reversal: false,
  status: 'active',
  commercial_status: null,
  refunded_amount: '0.00',
  outstanding_amount: '0.00',
  notes: null,
  created_at: '2026-07-20T14:34:00',
  updated_at: '2026-07-20T14:36:00',
  refunds: [],
  payments: [{ id: 1, amount: '240.00', method: '微信', collected_at: '2026-07-20', notes: null, operator_id: 1, created_at: '2026-07-20T14:36:00' }],
  items: [{
    id: 201,
    publication: 'cbj',
    publication_format: 'paper',
    fulfillment_type: 'subscription',
    billing_type: 'paid',
    subscription_term: 'one_year',
    delivery_method: 'post_office',
    term_start_month: '2026-08',
    coverage_start_date: '2026-08-03',
    coverage_end_date: '2027-07-26',
    issue_number: null,
    total_quantity: 1,
    unit_price: '240.00',
    subtotal: '240.00',
    expected_issues_at_creation: 49,
    status: 'active',
    notes: null,
    progress: { expected_at_creation: 49, current_expected: 49, drift: 0, synced_count: 0, shipped_count: 1, skipped_count: 0 },
    allocations: [{
      id: 301,
      version_no: 1,
      effective_from_issue: null,
      effective_until_issue: null,
      change_reason: null,
      created_at: '2026-07-20T14:34:00',
      targets: [{
        id: 401,
        recipient_name: '宋女士',
        recipient_phone: '13800008821',
        recipient_address: '北京市朝阳区建国路 88 号',
        recipient_postal_code: '100022',
        quantity: 1,
        // 历史目标可能仍保留默认快递渠道；详情应以订单明细的投递方式为准。
        shipping_channel: 'zto_outsource',
        effective_from_issue: null,
        effective_until_issue: null,
        status: 'active',
        notes: null,
      }],
    }],
  }],
}

const delivery = {
  id: 501,
  year: 2026,
  delivery_no: '6352',
  order_id: 96,
  order_item_id: 201,
  fulfillment_target_id: 401,
  order_code: 'ORD-2026-000001',
  external_order_no: '2026071622202732603212',
  recipient_name: '宋女士',
  recipient_phone: '13800008821',
  recipient_province: '北京市',
  recipient_city: '北京市',
  recipient_district: '朝阳区',
  recipient_address: '北京市朝阳区建国路 88 号',
  recipient_postal_code: '100022',
  product: '中国经营报',
  copies: 1,
  amount: '240.00',
  coverage_start_date: '2026-08-03',
  coverage_end_date: '2027-07-26',
  source_channel: '微信小程序',
  distribution_unit_id: null,
  distribution_unit_name: null,
  salesperson: null,
  remittance_name: null,
  source_type: 'order_generated',
  link_status: 'linked',
  link_message: null,
}

const createdChange = {
  id: 601,
  postal_delivery_id: 501,
  order_id: 96,
  external_order_no: '2026-6352',
  change_date: '2026-08-03T10:24:00',
  old_name: '宋女士',
  old_phone: '13800008821',
  old_address: '北京市朝阳区建国路 88 号',
  old_copies: 1,
  new_name: '宋女士',
  new_phone: '13800008821',
  new_address: '北京市海淀区中关村大街 27 号',
  new_copies: 1,
  original_start_month: '0803',
  effective_start_month: '0810',
  copy_allocations: null,
  unresolved_copies: 0,
  handling: null,
  routed_label: null,
  applied_to_order: false,
  applied_at: null,
  notes: '客户搬家',
}

const events: OrderEventOut[] = [
  { id: 4, event_type: 'synced_to_shipping', payload_json: { issue_number: 2655, created_count: 1, updated_count: 0 }, operator_id: null, created_at: '2026-07-30T15:43:00' },
  { id: 3, event_type: 'confirmed', payload_json: { order_code: 'ORD-2026-000001' }, operator_id: 1, created_at: '2026-07-30T15:42:14' },
  { id: 2, event_type: 'modified', payload_json: { diff: { paid_amount: { from: '0.00', to: '240.00' } } }, operator_id: 1, created_at: '2026-07-20T14:36:00' },
  { id: 1, event_type: 'created', payload_json: { entry_method: 'manual', items_count: 1 }, operator_id: 1, created_at: '2026-07-20T14:34:00' },
]

const complaintTicket = {
  type: 'complaint', id: 701, year: 2026, delivery_no: '6352', recipient_name: '宋女士',
  postal_delivery_id: 501, order_id: 96, ticket_date: '2026-08-04', summary: '漏收第 3001 期',
  status: 'in_progress', handling_count: 1, applied_to_order: null, pending_copies: 0, allocation_summary: null,
}

const addressTicket = {
  type: 'address', id: 601, year: 2026, delivery_no: '6352', recipient_name: '宋女士',
  postal_delivery_id: 501, order_id: 96, ticket_date: '2026-08-03', summary: '客户搬家，地址变更已应用',
  status: 'applied', handling_count: null, applied_to_order: true, pending_copies: 0, allocation_summary: null,
}

const resolvedComplaintTicket = {
  ...complaintTicket,
  id: 702,
  ticket_date: '2026-08-02',
  summary: '投递延迟，已回访确认收到',
  status: 'resolved',
}

const appliedChange = {
  ...createdChange,
  applied_to_order: true,
  applied_at: '2026-08-03T10:36:00',
}

const makeupTask = {
  id: 801, complaint_id: 701, order_id: 96, postal_delivery_id: 501,
  recipient_name: '宋女士', recipient_phone: '13800008821', recipient_address: '北京市朝阳区建国路 88 号',
  status: 'shipped', tracking_no: 'ZT20260804001', shipped_at: '2026-08-04T15:20:00', notes: '漏收补发',
  created_by: 1, created_at: '2026-08-04T14:30:00', updated_at: '2026-08-04T15:20:00',
  items: [{ id: 901, issue_number: 3001, quantity: 1, shipping_detail_id: 1001, shipped_at: '2026-08-04T15:20:00', shipped_quantity: 1, tracking_no: 'ZT20260804001' }],
}

const meta = {
  title: '页面/营销与交易/订单详情',
  component: OrderDetail,
  tags: ['ai-generated'],
  decorators: [withRouter],
  parameters: {
    layout: 'fullscreen',
    auth: { user: { username: 'admin', role: 'admin' }, isAdmin: true, isLoggedIn: true, setAuth: () => {}, logout: () => {} },
    reactRouter: reactRouterParameters({
      routing: { path: '/orders/:id' },
      location: { pathParams: { id: '96' } },
    }),
    msw: {
      handlers: [
        http.get('/api/orders/96', () => HttpResponse.json(order)),
        http.get('/api/orders/96/events', () => HttpResponse.json(events)),
        http.get('/api/postal/deliveries', () => HttpResponse.json({ rows: [delivery], total: 1, summary: { total_copies: 1, unit_count: 0, missing_unit_count: 1, nearest_expiry_date: null } })),
        http.get('/api/postal/tickets', () => HttpResponse.json({ rows: [], total: 0, summary: { complaint: 0, address: 0, follow: 0, address_recipient_pending: 0 } })),
        http.get('/api/postal/makeups', () => HttpResponse.json({ rows: [], total: 0 })),
        http.get('/api/issues', () => HttpResponse.json([])),
        http.post('/api/postal/tickets', async ({ request }) => HttpResponse.json({ ...createdChange, ...await request.json() as object }, { status: 201 })),
        http.get('/api/postal/tickets/601', () => HttpResponse.json(createdChange)),
        http.post('/api/postal/tickets/601/apply', () => HttpResponse.json({ ...createdChange, applied_to_order: true, applied_at: '2026-08-03T10:36:00' })),
      ],
    },
  },
} satisfies Meta<typeof OrderDetail>

export default meta
type Story = StoryObj<typeof meta>

export const Overview: Story = {
  name: '订单详情总览',
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('1 / 49 期')).toBeVisible()
    await expect(canvas.getByText('已开具')).toBeVisible()
    await expect(canvas.getByText('累计已开 ¥240.00')).toBeVisible()
    await expect(canvas.getByRole('button', { name: /查看发票/ })).toBeVisible()
    await expect(canvas.getByText('已履约')).toBeVisible()
    await expect(await canvas.findByText('已关联 · 1 条')).toBeVisible()
    await expect(canvas.getByText(/邮局投递 · 履约中/)).toBeVisible()
    await userEvent.click(canvas.getByRole('tab', { name: /履约方案/ }))
    const planPanel = within(canvas.getByRole('tabpanel'))
    await expect(await planPanel.findByText('当前履约方案')).toBeVisible()
    await expect(planPanel.getByText('目标份数')).toBeVisible()
    await expect(planPanel.getByText('1 份')).toBeVisible()
    await expect(planPanel.getByText('邮局投递')).toBeVisible()
    await expect(planPanel.queryByText('中通快递')).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole('tab', { name: /收款记录/ }))
    await expect(await within(canvas.getByRole('tabpanel')).findByText('收款流水 #1')).toBeVisible()
    await userEvent.click(canvas.getByRole('tab', { name: /关联快递/ }))
    await expect(await within(canvas.getByRole('tabpanel')).findByText('本订单采用邮局投递')).toBeVisible()
    await userEvent.click(canvas.getByRole('tab', { name: /关联邮局/ }))
    await expect(await within(canvas.getByRole('tabpanel')).findByText('邮局投递 #6352')).toBeVisible()
    await userEvent.click(canvas.getByRole('tab', { name: /事件流/ }))
    const eventsPanel = within(canvas.getByRole('tabpanel'))
    await expect(await eventsPanel.findByText('确认', { exact: true })).toBeVisible()
    await expect(eventsPanel.getByText('录入方式：手工录入 · 订单明细：1 条')).toBeVisible()
    await expect(eventsPanel.queryByText('查看完整数据')).not.toBeInTheDocument()
  },
}

export const AddressChangeFlow: Story = {
  name: '地址变更流程入口',
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('ORD-2026-000001')).toBeVisible()
    await expect(await canvas.findByText('北京市朝阳区建国路 88 号')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /修改收件信息/ })).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole('tab', { name: /履约档案/ }))
    const dossierPanel = within(canvas.getByRole('tabpanel'))
    await userEvent.click(await dossierPanel.findByRole('button', { name: /修改收件信息/ }))
    const body = within(document.body)
    await waitFor(() => expect(body.getByRole('dialog')).toBeVisible())
    const dialog = within(body.getByRole('dialog'))
    await expect(dialog.getByText('新建收件信息变更')).toBeVisible()
    await expect(dialog.getByText('保存后生成待应用工单，不会立即覆盖当前地址')).toBeVisible()
    await userEvent.type(dialog.getByLabelText('新投递地址'), '北京市海淀区中关村大街 27 号')
    await userEvent.type(dialog.getByLabelText('变更原因'), '客户搬家')
    await userEvent.click(dialog.getByRole('button', { name: '创建变更工单' }))
    const detailTitle = await body.findByText('收件信息变更工单 #601')
    await waitFor(() => expect(detailTitle).toBeVisible())
    const detailDialog = within(detailTitle.closest('[role="dialog"]') as HTMLElement)
    await expect(detailDialog.getByRole('button', { name: '确认完成并应用' })).toBeVisible()
  },
}

export const ComplaintMakeupFlow: Story = {
  name: '邮局投诉与中通补发闭环',
  parameters: {
    msw: {
      handlers: [
        http.get('/api/orders/96', () => HttpResponse.json(order)),
        http.get('/api/orders/96/events', () => HttpResponse.json(events)),
        http.get('/api/postal/deliveries', () => HttpResponse.json({ rows: [delivery], total: 1, summary: { total_copies: 1, unit_count: 0, missing_unit_count: 1, nearest_expiry_date: null } })),
        http.get('/api/postal/tickets', () => HttpResponse.json({ rows: [complaintTicket], total: 1, summary: { complaint: 1, address: 0, follow: 0, address_recipient_pending: 0 } })),
        http.get('/api/postal/makeups', () => HttpResponse.json({ rows: [makeupTask], total: 1 })),
        http.get('/api/issues', () => HttpResponse.json([])),
      ],
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('该订单存在邮局投递异常处理')).toBeVisible()
    await expect(canvas.getByText('1 / 49 期')).toBeVisible()
    await userEvent.click(canvas.getByRole('tab', { name: /关联快递/ }))
    const expressPanel = within(canvas.getByRole('tabpanel'))
    await expect(await expressPanel.findByText('投诉补发 #801')).toBeVisible()
    await expect(expressPanel.getByText('ZT20260804001')).toBeVisible()
    await expect(expressPanel.getByText(/原订单采用邮局投递/)).toBeVisible()
    await userEvent.click(canvas.getByRole('tab', { name: /关联邮局/ }))
    const postalPanel = within(canvas.getByRole('tabpanel'))
    await expect(await postalPanel.findByText('投诉 #701 · 处理中')).toBeVisible()
    await expect(postalPanel.getByText('中通补发 #801 · 已发出')).toBeVisible()
    await userEvent.click(canvas.getByRole('tab', { name: /履约档案/ }))
    const dossierPanel = within(canvas.getByRole('tabpanel'))
    await expect(await dossierPanel.findByText('投诉 #701')).toBeVisible()
    await expect(dossierPanel.getByText('漏收第 3001 期')).toBeVisible()
  },
}

export const FulfillmentDossier: Story = {
  name: '履约档案与订单摘要',
  parameters: {
    msw: {
      handlers: [
        http.get('/api/orders/96', () => HttpResponse.json(order)),
        http.get('/api/orders/96/events', () => HttpResponse.json(events)),
        http.get('/api/postal/deliveries', () => HttpResponse.json({
          rows: [{ ...delivery, recipient_address: appliedChange.new_address }],
          total: 1,
          summary: { total_copies: 1, unit_count: 0, missing_unit_count: 1, nearest_expiry_date: null },
        })),
        http.get('/api/postal/tickets', () => HttpResponse.json({
          rows: [addressTicket, complaintTicket, resolvedComplaintTicket],
          total: 3,
          summary: { complaint: 2, address: 1, follow: 0, address_recipient_pending: 0 },
        })),
        http.get('/api/postal/tickets/601', () => HttpResponse.json(appliedChange)),
        http.get('/api/postal/makeups', () => HttpResponse.json({ rows: [], total: 0 })),
        http.get('/api/issues', () => HttpResponse.json([])),
      ],
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('地址变更 1 · 投诉 2')).toBeVisible()
    await expect(canvas.queryByText('查看投递与变更')).not.toBeInTheDocument()
    await expect(canvas.queryByText('查看变更记录')).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole('tab', { name: /履约档案/ }))
    const dossierPanel = within(canvas.getByRole('tabpanel'))
    await expect(await dossierPanel.findByText('北京市朝阳区建国路 88 号')).toBeVisible()
    await expect(dossierPanel.getAllByText('北京市海淀区中关村大街 27 号')[0]).toBeVisible()
    await expect(dossierPanel.getByText('投诉 #701')).toBeVisible()
    await expect(dossierPanel.getByText('投诉 #702')).toBeVisible()
  },
}
