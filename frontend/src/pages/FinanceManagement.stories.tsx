import type { Meta, StoryObj } from '@storybook/react-vite'
import { http, HttpResponse, delay } from 'msw'
import { expect, within, waitFor } from 'storybook/test'
import { withRouter, reactRouterParameters } from 'storybook-addon-remix-react-router'
import FinanceManagement from './FinanceManagement'

// 财务管理：GET /api/invoices/orders（发票工作台）+ GET /api/settlements（渠道结算）
// + GET /api/partners（结算筛选/下拉）。写操作按 isAdmin 显隐。
const TS = '2026-06-01T00:00:00Z'

const invoiceOrders = {
  rows: [
    {
      order_id: 1, order_code: 'CBJ-2026-0001', payer_name: '北京某公司', order_date: '2026-06-01',
      total_amount: '360.00', refunded_amount: '0.00', invoice_required: true,
      invoice_title: '北京某公司', invoice_tax_no: '91110000XXXXXX',
      invoice_recipient_email: 'billing@example.com', invoices: [],
      normal_invoiced_amount: '0.00', remaining_invoice_amount: '360.00',
      invoice_state: 'pending', needs_red_reversal: false, order_voided: false,
    },
    {
      order_id: 2, order_code: 'CBJ-2026-0002', payer_name: '上海某单位', order_date: '2026-05-20',
      total_amount: '240.00', refunded_amount: '60.00', invoice_required: true,
      invoice_title: '上海某单位', invoice_tax_no: null, invoice_recipient_email: null,
      normal_invoiced_amount: '240.00', remaining_invoice_amount: '0.00',
      invoices: [{ id: 10, order_id: 2, invoice_type: 'normal', invoice_no: 'INV-2002', amount: '240.00', issued_date: '2026-05-21', buyer_title: '上海某单位', tax_no: null, attachment_filename: '电子发票.png', has_attachment: true, notes: null, created_at: TS, updated_at: TS }],
      invoice_state: 'needs_red_reversal', needs_red_reversal: true, order_voided: false,
    },
  ],
  total: 2, pending_count: 1, needs_red_reversal_count: 1, issued_count: 0,
}

const settlements = [
  { id: 1, partner_id: 1, partner_name: '中通', contract_id: null, direction: 'payable', party_type: 'channel', settlement_type: null, system_no: 'JS-QD-202608-000001', external_no: 'ZT-2026-Q1', settlement_no: 'ZT-2026-Q1', period: null, settlement_start_date: '2026-01-01', settlement_end_date: '2026-03-31', return_start_date: null, return_end_date: null, gross_amount: '120000.00', return_deduction_amount: '0.00', amount_due: '120000.00', paid_amount: '120000.00', paid_date: '2026-04-10', on_time: true, invoice_received: true, invoice_status: 'issued', payment_status: 'paid', invoice_no: 'ZT-FP-001', invoice_date: '2026-04-09', invoice_title: '中通快递', invoice_tax_no: null, invoice_taxpayer_type: 'general', invoice_type: 'vat_special', invoice_item_name: '物流服务', invoice_unit: '次', invoice_quantity: null, invoice_unit_price: null, invoice_tax_rate: '0.0600', invoice_amount: '120000.00', status: 'invoiced', attachment_filename: '结算单.pdf', has_attachment: true, attachments: [{ id: 1, category: 'settlement_sheet', filename: '结算单.pdf', content_type: 'application/pdf', file_size: 1024, sha256: 'demo', is_primary: true, recognized: null, recognition_parser_version: null, recognition_result: null, created_at: TS }], notes: null, created_at: TS, updated_at: TS },
  { id: 2, partner_id: 2, partner_name: '北京市报刊发行局', contract_id: null, direction: 'receivable', party_type: 'channel', settlement_type: 'consignment', system_no: 'JS-QD-202608-000002', external_no: 'JS-2026-001', settlement_no: 'JS-2026-001', period: null, settlement_start_date: '2026-06-01', settlement_end_date: '2026-06-29', return_start_date: '2026-05-04', return_end_date: '2026-06-29', gross_amount: '14437.50', return_deduction_amount: '13794.00', amount_due: '643.50', paid_amount: null, paid_date: null, on_time: null, invoice_received: false, invoice_status: 'unissued', payment_status: 'unpaid', invoice_no: null, invoice_date: null, invoice_title: '北京市报刊零售有限公司', invoice_tax_no: '91110102101537026D', invoice_taxpayer_type: 'general', invoice_type: 'vat_normal', invoice_item_name: '*印刷品*中国经营报', invoice_unit: '份', invoice_quantity: '234.00', invoice_unit_price: '2.7500', invoice_tax_rate: '0.0900', invoice_amount: '643.50', status: 'pending', attachment_filename: null, has_attachment: false, attachments: [], notes: null, created_at: TS, updated_at: TS },
]

const partners = [
  { id: 1, name: '中通', partner_type: 'logistics', contact_person: null, contact_phone: null, settlement_account: null, invoice_title: null, tax_no: null, taxpayer_type: null, default_invoice_type: null, default_tax_rate: null, default_invoice_content: null, default_invoice_unit: null, default_invoice_unit_price: null, notes: null, active: true, created_at: TS, updated_at: TS },
  { id: 2, name: '北京市报刊发行局', partner_type: 'distribution', contact_person: null, contact_phone: null, settlement_account: null, invoice_title: '北京市报刊零售有限公司', tax_no: '91110102101537026D', taxpayer_type: 'general', default_invoice_type: 'vat_normal', default_tax_rate: '0.0900', default_invoice_content: '*印刷品*中国经营报', default_invoice_unit: '份', default_invoice_unit_price: '2.7500', notes: null, active: true, created_at: TS, updated_at: TS },
]
const configuredPartners = partners.map((partner, index) => ({
  ...partner,
  sales_mode_policy: index === 1 ? 'required' : 'not_applicable',
}))

const settlementPreview = {
  recognized: true,
  parser_version: 'test-v1',
  filename: '北京报零结算.xlsx',
  supplier_name: '北京市报刊零售有限公司',
  external_no: 'AUTO-202608-001',
  settlement_start_date: '2026-08-03',
  settlement_end_date: '2026-08-09',
  return_start_date: '2026-07-27',
  return_end_date: '2026-08-02',
  gross_amount: '1000.00',
  return_deduction_amount: '120.00',
  amount_due: '880.00',
  invoice_item_name: '*印刷品*中国经营报',
  invoice_quantity: '320.00',
  invoice_unit_price: '2.7500',
  invoice_amount: '880.00',
  detail_count: 12,
  return_detail_count: 2,
  warnings: [],
}

const adminAuth = { user: { id: 1, username: 'admin', role: 'admin' }, isAdmin: true, isLoggedIn: true, setAuth: () => {}, logout: () => {} }
const operatorAuth = { user: { id: 2, username: 'op', role: 'operator' }, isAdmin: false, isLoggedIn: true, setAuth: () => {}, logout: () => {} }

const dataHandlers = [
  http.get('/api/invoices/orders', () => HttpResponse.json(invoiceOrders)),
  http.get('/api/invoices/:invoiceId/attachment', () => new HttpResponse(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="100%" height="100%" fill="#fff"/><text x="50%" y="50%" text-anchor="middle" font-size="32">电子发票预览</text></svg>',
    { headers: { 'Content-Type': 'image/svg+xml' } },
  )),
  http.get('/api/settlements', () => HttpResponse.json(settlements)),
  http.get('/api/settlements/:settlementId/history', () => HttpResponse.json([
    { id: 1, action: 'create', changes: {}, username: 'admin', created_at: TS },
  ])),
  http.get('/api/partners', () => HttpResponse.json(configuredPartners)),
  http.post('/api/settlements/import/preview', () => HttpResponse.json(settlementPreview)),
]

const meta = {
  title: '页面/合同与财务/财务管理',
  component: FinanceManagement,
  tags: ['ai-generated'],
  decorators: [withRouter],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          '财务工作台：「订单发票」工作台（待开票/已开票/需冲红）+「渠道结算」（对账打款/进项发票/附件归档）。写操作按 isAdmin 显隐，发票记录对登录用户可读。演示 管理员/操作员（只读）/空/登记发票弹窗/发票记录/切到结算页。',
      },
    },
  },
} satisfies Meta<typeof FinanceManagement>

export default meta
type Story = StoryObj<typeof meta>

// 管理员：发票工作台 + 登记入口
export const Loaded: Story = {
  name: '已加载',
  parameters: { auth: adminAuth, msw: { handlers: dataHandlers } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('CBJ-2026-0001')).toBeVisible()
    expect((await canvas.findAllByRole('button', { name: /登记发票/ })).length).toBe(1)
    await expect(await canvas.findByText('待开 ¥360.00')).toBeVisible()
  },
}

// 操作员（只读）：无登记按钮
export const OperatorReadonly: Story = {
  name: '操作员只读',
  parameters: { auth: operatorAuth, msw: { handlers: dataHandlers } },
  play: async ({ canvas }) => {
    await canvas.findByText('CBJ-2026-0001')
    expect(canvas.queryByRole('button', { name: /登记发票/ })).toBeNull()
  },
}

// 交互：点「登记发票」打开弹窗
export const RegisterInvoice: Story = {
  name: '登记发票',
  parameters: { auth: adminAuth, msw: { handlers: dataHandlers } },
  play: async ({ canvas, userEvent }) => {
    const buttons = await canvas.findAllByRole('button', { name: /登记发票/ })
    await userEvent.click(buttons[0])
    const dialog = await within(document.body).findByRole('dialog')
    await waitFor(() => expect(dialog).toBeVisible())
    await expect(await within(dialog).findByDisplayValue('billing@example.com')).toBeVisible()
    await expect(await within(dialog).findByText('电子发票（选填）')).toBeVisible()
  },
}

// 交互：打开记录弹窗，查看已登记发票的金额与票号
export const ViewInvoiceRecords: Story = {
  name: '查看发票记录',
  parameters: { auth: operatorAuth, msw: { handlers: dataHandlers } },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.click(await canvas.findByRole('button', { name: /查看记录/ }))
    const dialog = await page.findByRole('dialog')
    await waitFor(() => expect(dialog).toBeVisible())
    await expect((await within(dialog).findAllByText('¥240.00')).length).toBeGreaterThan(0)
    await expect(await within(dialog).findByText(/发票号 INV-2002/)).toBeVisible()
    await expect(await within(dialog).findByText('电子发票.png')).toBeVisible()
    expect(within(dialog).queryByRole('button', { name: /删除/ })).toBeNull()
    await expect(await within(dialog).findByRole('button', { name: /预览/ })).toBeVisible()
    await expect(await within(dialog).findByRole('button', { name: /下载/ })).toBeVisible()
  },
}

// 深链接：从订单详情进入后，直接打开该订单的发票记录。
export const DeepLinkedInvoiceRecords: Story = {
  name: '订单详情跳转查看发票',
  parameters: {
    auth: operatorAuth,
    msw: { handlers: dataHandlers },
    reactRouter: reactRouterParameters({
      location: { path: '/finance', searchParams: { invoice_order_id: '2' } },
      routing: { path: '/finance' },
    }),
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    const dialog = await page.findByRole('dialog')
    await waitFor(() => expect(dialog).toBeVisible())
    await expect(await within(dialog).findByText(/发票记录 · CBJ-2026-0002/)).toBeVisible()
    await expect(await within(dialog).findByText(/发票号 INV-2002/)).toBeVisible()
  },
}

// 交互：切到「渠道结算」页签，结算行渲染
export const SettlementsTab: Story = {
  name: '渠道结算页签',
  parameters: { auth: adminAuth, msw: { handlers: dataHandlers } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('tab', { name: '渠道结算' }))
    await expect(await canvas.findByText('中通')).toBeVisible()
  },
}

export const SettlementDetails: Story = {
  name: '结算详情与后续操作',
  parameters: { auth: adminAuth, msw: { handlers: dataHandlers } },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(await canvas.findByRole('tab', { name: '渠道结算' }))
    const detailButtons = await canvas.findAllByRole('button', { name: '查看详情' })
    await userEvent.click(detailButtons[0])
    const body = within(canvasElement.ownerDocument.body)
    const drawerTitle = await body.findByText(/结算详情 · JS-QD-/)
    const drawer = drawerTitle.closest<HTMLElement>('.ant-drawer')
    await expect(drawer).not.toBeNull()
    if (!drawer) return
    await expect(await within(drawer).findByText('结算信息')).toBeVisible()
    await expect(await within(drawer).findByText('附件')).toBeVisible()
    await expect(await within(drawer).findByText('开票')).toBeVisible()
    await expect(await within(drawer).findByText('操作记录')).toBeVisible()
  },
}

export const CreateStructuredSettlement: Story = {
  name: '新增结构化渠道结算',
  parameters: { auth: adminAuth, msw: { handlers: dataHandlers } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('tab', { name: '渠道结算' }))
    await userEvent.click(await canvas.findByRole('button', { name: /新增结算/ }))
    const dialog = await within(document.body).findByRole('dialog')
    await expect(await within(dialog).findByText('收付方向')).toBeInTheDocument()
    await expect(await within(dialog).findByText('结算周期')).toBeInTheDocument()
    await expect(await within(dialog).findByText('退报周期')).toBeInTheDocument()
    await expect(await within(dialog).findByText('系统结算单号')).toBeInTheDocument()
    await expect(await within(dialog).findByText('外部平台单号')).toBeInTheDocument()
    await expect(within(dialog).queryByText('销售模式')).not.toBeInTheDocument()
    await expect(await within(dialog).findByText('待保存')).toBeInTheDocument()
    const uploadFirst = await within(dialog).findByText('结算凭证')
    const partnerField = await within(dialog).findByText('结算对象')
    await expect(uploadFirst.compareDocumentPosition(partnerField) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await expect(await within(dialog).findByText('选择并识别附件')).toBeInTheDocument()
    await expect(within(dialog).getByLabelText('退报周期').closest('.ant-form-item')).toHaveClass('finance-settlement-period-half')
    await expect(within(dialog).getByLabelText('备注').closest('.ant-form-item')).toHaveClass('finance-settlement-period-wide')
    await expect(within(dialog).queryByText('主结算单')).not.toBeInTheDocument()
    await expect(within(dialog).queryByText('已归类')).not.toBeInTheDocument()
    await expect(within(dialog).queryByText('开票日期')).not.toBeInTheDocument()
    await expect(within(dialog).queryByText('本次金额')).not.toBeInTheDocument()
  },
}

export const RecognitionPreservesManualValues: Story = {
  name: '识别只补空字段',
  parameters: { auth: adminAuth, msw: { handlers: dataHandlers } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('tab', { name: '渠道结算' }))
    await userEvent.click(await canvas.findByRole('button', { name: /新增结算/ }))
    const dialog = await within(document.body).findByRole('dialog')
    const externalNo = await within(dialog).findByLabelText('外部平台单号')
    await userEvent.type(externalNo, 'MANUAL-001')
    const fileInput = dialog.querySelector<HTMLInputElement>('input[type="file"]')
    if (!fileInput) throw new Error('未找到附件上传控件')
    await userEvent.upload(fileInput, new File(['xlsx'], '北京报零结算.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }))
    await expect(await within(dialog).findByText(/已保留人工填写：外部平台单号/)).toBeVisible()
    await expect(externalNo).toHaveValue('MANUAL-001')
    await expect(await within(dialog).findByText(/已自动填入：结算周期/)).toBeVisible()
    const recognition = await within(dialog).findByText(/此结算单识别结果/)
    const attachmentRow = recognition.closest('.finance-settlement-attachment-row')
    await expect(attachmentRow).not.toBeNull()
    await expect(attachmentRow).toContainElement(within(dialog).getByLabelText('北京报零结算.xlsx的附件类型'))
    await expect(within(dialog).queryByText('主结算单')).not.toBeInTheDocument()
  },
}

export const PartnerLoadFailure: Story = {
  name: '合作渠道加载失败',
  parameters: {
    auth: adminAuth,
    msw: {
      handlers: [
        http.get('/api/invoices/orders', () => HttpResponse.json(invoiceOrders)),
        http.get('/api/settlements', () => HttpResponse.json(settlements)),
        http.get('/api/partners', () => HttpResponse.json({ detail: '数据库版本未更新' }, { status: 500 })),
      ],
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('tab', { name: '渠道结算' }))
    await userEvent.click(await canvas.findByRole('button', { name: /新增结算/ }))
    const dialog = await within(document.body).findByRole('dialog')
    await expect(await within(dialog).findByText('合作渠道加载失败，当前无法选择结算对象')).toBeInTheDocument()
    await expect(within(dialog).queryByText('暂无数据')).not.toBeInTheDocument()
  },
}

// 空
export const Empty: Story = {
  name: '空状态',
  parameters: {
    auth: adminAuth,
    msw: {
      handlers: [
        http.get('/api/invoices/orders', () => HttpResponse.json({ rows: [], total: 0, pending_count: 0, needs_red_reversal_count: 0, issued_count: 0 })),
        http.get('/api/settlements', () => HttpResponse.json([])),
        http.get('/api/partners', () => HttpResponse.json([])),
      ],
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('tab', { name: '渠道结算' }))
    await userEvent.click(await canvas.findByRole('button', { name: /新增结算/ }))
    const dialog = await within(document.body).findByRole('dialog')
    await expect(await within(dialog).findByText('尚未维护可用的合作渠道')).toBeInTheDocument()
    await expect(within(dialog).queryByText('合作渠道加载失败，当前无法选择结算对象')).not.toBeInTheDocument()
  },
}

// 加载中
export const Loading: Story = {
  name: '加载中',
  parameters: {
    auth: adminAuth,
    msw: {
      handlers: [
        http.get('/api/invoices/orders', async () => { await delay('infinite'); return HttpResponse.json(invoiceOrders) }),
        http.get('/api/settlements', () => HttpResponse.json(settlements)),
        http.get('/api/partners', () => HttpResponse.json(configuredPartners)),
      ],
    },
  },
}
