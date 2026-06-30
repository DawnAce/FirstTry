import type { Meta, StoryObj } from '@storybook/react-vite'
import { http, HttpResponse, delay } from 'msw'
import { expect, within, waitFor } from 'storybook/test'
import ContractManagement from './ContractManagement'

// 合同管理：GET /api/contracts（合同列表）+ GET /api/partners（渠道，供筛选/下拉）。
// 写操作按 isAdmin 显隐——故事用 parameters.auth 切换管理员 / 操作员视角。
const partners = [
  { id: 1, name: '中通', partner_type: 'logistics', contact_person: '张经理', contact_phone: '13800000000', settlement_account: '工行 6222...', notes: null, active: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
  { id: 2, name: '北京市报刊发行局', partner_type: 'distribution', contact_person: null, contact_phone: null, settlement_account: null, notes: null, active: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
]

const contracts = [
  { id: 10, partner_id: 1, partner_name: '中通', partner_type: 'logistics', contract_no: 'ZT-2026-001', title: '2026 年度中通物流配送合作合同', sign_year: 2026, sign_date: '2026-01-05', start_date: '2026-01-01', end_date: '2026-12-31', amount: '120000.00', status: 'active', attachment_filename: '中通合同.pdf', has_attachment: true, is_expiring: false, notes: null, created_at: '2026-01-05T00:00:00Z', updated_at: '2026-01-05T00:00:00Z' },
  { id: 11, partner_id: 2, partner_name: '北京市报刊发行局', partner_type: 'distribution', contract_no: null, title: '2026 报刊发行渠道合作协议', sign_year: 2026, sign_date: null, start_date: '2026-03-01', end_date: '2026-07-15', amount: null, status: 'active', attachment_filename: null, has_attachment: false, is_expiring: true, notes: null, created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z' },
]

const adminAuth = { user: { id: 1, username: 'admin', role: 'admin' }, isAdmin: true, isLoggedIn: true, setAuth: () => {}, logout: () => {} }
const operatorAuth = { user: { id: 2, username: 'op', role: 'operator' }, isAdmin: false, isLoggedIn: true, setAuth: () => {}, logout: () => {} }

const dataHandlers = [
  http.get('/api/contracts', () => HttpResponse.json(contracts)),
  http.get('/api/partners', () => HttpResponse.json(partners)),
]

const meta = {
  title: '页面/ContractManagement（合同管理）',
  component: ContractManagement,
  tags: ['ai-generated'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          '合同管理：GET /api/contracts + GET /api/partners 驱动「合同」「合作渠道」两个页签。合同含渠道、有效期（快到期提示）、状态、扫描件附件。写操作按 isAdmin 显隐。演示 管理员 / 操作员（只读）/ 空 / 打开新增弹窗。',
      },
    },
  },
} satisfies Meta<typeof ContractManagement>

export default meta
type Story = StoryObj<typeof meta>

// 管理员视角：含新增/编辑/删除/上传
export const Loaded: Story = {
  parameters: { auth: adminAuth, msw: { handlers: dataHandlers } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('2026 年度中通物流配送合作合同')).toBeVisible()
    // 管理员能看到写操作入口
    await expect(await canvas.findByRole('button', { name: /新增合同/ })).toBeVisible()
  },
}

// 操作员（只读）：无写操作按钮，可下载附件——把「按 isAdmin 显隐」锁进回归
export const OperatorReadonly: Story = {
  parameters: { auth: operatorAuth, msw: { handlers: dataHandlers } },
  play: async ({ canvas }) => {
    await canvas.findByText('2026 年度中通物流配送合作合同') // 先确保数据已渲染
    expect(canvas.queryByRole('button', { name: /新增合同/ })).toBeNull()
    expect(canvas.queryByText('编辑')).toBeNull()
    await expect(await canvas.findByText('下载')).toBeVisible() // 下载仍可用
  },
}

// 空
export const Empty: Story = {
  parameters: {
    auth: adminAuth,
    msw: {
      handlers: [
        http.get('/api/contracts', () => HttpResponse.json([])),
        http.get('/api/partners', () => HttpResponse.json([])),
      ],
    },
  },
}

// 交互：点击「新增合同」打开弹窗（portal 渲染在 document.body）
export const CreateModal: Story = {
  parameters: { auth: adminAuth, msw: { handlers: dataHandlers } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { name: /新增合同/ }))
    // Modal 在 document.body 的 portal 中；等 zoom 入场动画结束后才算可见
    const dialog = await within(document.body).findByRole('dialog')
    await waitFor(() => expect(dialog).toBeVisible())
  },
}

// 加载中：列表接口不返回，表格保持 loading
export const Loading: Story = {
  parameters: {
    auth: adminAuth,
    msw: {
      handlers: [
        http.get('/api/contracts', async () => { await delay('infinite'); return HttpResponse.json(contracts) }),
        http.get('/api/partners', () => HttpResponse.json(partners)),
      ],
    },
  },
}
