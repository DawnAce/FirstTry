import type { Meta, StoryObj } from '@storybook/react-vite'
import { withRouter, reactRouterParameters } from 'storybook-addon-remix-react-router'
import { http, HttpResponse, delay } from 'msw'
import ShippingPreview from './ShippingPreview'
import type { Issue } from '../api/issues'
import type { ShippingRecord } from '../api/shipping'

// —— 假数据 ——
const issue: Issue = {
  id: 1,
  issue_number: 2652,
  year_issue_index: 18,
  year_issue_label: '2026年第18期',
  publish_date: '2026-05-12',
  page_count: 16,
  planned_page_count: 16,
  status: 'confirmed',
  notes: null,
  created_at: '2026-05-01T08:00:00Z',
  updated_at: '2026-05-10T09:30:00Z',
}

const records: ShippingRecord[] = [
  { id: 1, issue_id: 1, recipient_id: 101, recipient_name: '北京某某传媒有限公司', recipient_address: '北京市朝阳区建国路 88 号', recipient_phone: '010-88886666', recipient_type: 'corporate', quantity: 20, status: 'pending' },
  { id: 2, issue_id: 1, recipient_id: 102, recipient_name: '张读者', recipient_address: '上海市浦东新区世纪大道 100 号', recipient_phone: '13800001111', recipient_type: 'reader', quantity: 1, status: 'pending' },
  { id: 3, issue_id: 1, recipient_id: 103, recipient_name: '样报赠阅', recipient_address: '广州市天河区天河路 1 号', recipient_phone: null, recipient_type: 'sample', quantity: 2, status: 'pending' },
]

// issue 接口在三个 story 里都一样，抽出来复用
const issueHandler = http.get('/api/issues/1', () => HttpResponse.json(issue))

const meta = {
  title: '页面/ShippingPreview（发货明细）',
  component: ShippingPreview,
  // 该页用 useParams 读 issueId、useNavigate 跳转，需要路由环境
  decorators: [withRouter],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          '发货明细页：依赖路由参数 issueId + react-query 拉取 /api 数据。本 story 用 MSW 假造接口，演示「有数据 / 空 / 加载中」三种状态，可作为其它页面接入 Storybook 的模板。',
      },
    },
    // 注入路由：path 带 :issueId，并给定 issueId=1
    reactRouter: reactRouterParameters({
      routing: { path: '/shipping/:issueId' },
      location: { pathParams: { issueId: '1' } },
    }),
  },
} satisfies Meta<typeof ShippingPreview>

export default meta
type Story = StoryObj<typeof meta>

// 有数据
export const Loaded: Story = {
  parameters: {
    msw: {
      handlers: [
        issueHandler,
        http.get('/api/issues/1/shipping', () => HttpResponse.json(records)),
      ],
    },
  },
}

// 空列表（已生成但无收件人）
export const Empty: Story = {
  parameters: {
    msw: {
      handlers: [
        issueHandler,
        http.get('/api/issues/1/shipping', () => HttpResponse.json([])),
      ],
    },
  },
}

// 加载中（shipping 接口一直不返回，页面显示 Spin）
export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        issueHandler,
        http.get('/api/issues/1/shipping', async () => {
          await delay('infinite')
          return HttpResponse.json([])
        }),
      ],
    },
  },
}
