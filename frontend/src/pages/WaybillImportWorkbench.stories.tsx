import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { HttpResponse, http } from 'msw';
import { reactRouterParameters, withRouter } from 'storybook-addon-remix-react-router';
import WaybillImportWorkbench from './WaybillImportWorkbench';
import type { WaybillImportBatch, WaybillImportRow } from '../api/shippingWaybills';

const issue = {
  id: 18,
  issue_number: 2638,
  year_issue_index: 4,
  year_issue_label: '四',
  publish_date: '2026-01-26',
  page_count: 24,
  planned_page_count: 24,
  status: 'confirmed',
  notes: null,
  created_at: '2026-01-20T09:00:00',
  updated_at: '2026-01-26T09:00:00',
};

const makeRow = (
  id: number,
  status: WaybillImportRow['match_status'],
  quantity: number,
  overrides: Partial<WaybillImportRow> = {},
): WaybillImportRow => ({
  id,
  source_sheet: '中通+顺丰到付',
  source_row: id + 2,
  carrier: '中通',
  tracking_no: status === 'invalid' ? null : `7359281752${String(id).padStart(4, '0')}`,
  recipient_name: `收件人 ${id}`,
  phone: `1380000${String(id).padStart(4, '0')}`,
  address: `北京市朝阳区示例路 ${id} 号`,
  quantity,
  no_tracking_required: false,
  raw_values: ['经营报', '', `7359281752${String(id).padStart(4, '0')}`, '', `1380000${String(id).padStart(4, '0')}`, `北京市朝阳区示例路 ${id} 号`, `收件人 ${id}`, String(quantity)],
  manual_reviewed: false,
  match_status: status,
  match_reason: status === 'matched' ? null : '未找到对应发货明细',
  shipping_detail_id: status === 'matched' ? id : null,
  ...overrides,
});

const matchedRows = Array.from({ length: 55 }, (_, index) =>
  makeRow(index + 1, 'matched', index === 54 ? 415 : 10),
);
const unresolvedRows = [
  makeRow(101, 'unmatched', 299, { source_sheet: '299（备用74+社用225）', tracking_no: null, no_tracking_required: true, carrier: '无需运单', recipient_name: '库房与社用汇总', match_reason: '未找到对应发货明细' }),
  makeRow(102, 'ambiguous', 50, { recipient_name: '发行部', match_reason: '匹配到多条发货明细，请人工选择' }),
  makeRow(103, 'invalid', 15, { recipient_name: '', match_reason: '未能按当前工作表格式识别，请人工补充' }),
  makeRow(104, 'duplicate', 1, { match_reason: '待导入数据中运单号重复' }),
];

const batch: WaybillImportBatch = {
  id: 1,
  issue_id: 18,
  issue_number: 2638,
  filename: '单号-经营报1-26日.xlsx',
  status: 'previewed',
  expected_quantity: 1321,
  parsed_quantity: 1320,
  matched_quantity: 955,
  pending_quantity: 366,
  extra_quantity: 0,
  matched_rows: 55,
  unmatched_rows: 4,
  warning_count: 4,
  created_at: '2026-01-26T15:30:00',
  confirmed_at: null,
  rows: [...matchedRows, ...unresolvedRows],
};

const details = [
  { id: 1, name: '收件人 1', phone: '13800000001', address: '北京市朝阳区示例路 1 号', quantity: 10 },
  { id: 201, name: '库房', phone: '13900000000', address: '中通库房', quantity: 74 },
  { id: 202, name: '社用报', phone: '13900000001', address: '报社', quantity: 225 },
  { id: 203, name: '发行部', phone: '13800000102', address: '北京市朝阳区示例路 102 号', quantity: 30 },
  { id: 204, name: '发行部', phone: '13800000102', address: '北京市朝阳区示例路 102 号', quantity: 20 },
].map((detail) => ({
  ...detail,
  issue_number: 2638,
  sheet_name: '确认版',
  channel: '个人订阅',
  sub_channel: null,
  transport: '中通物流',
  frequency: '周',
  status: '正常',
  deadline: null,
  notes: null,
  extra_info: null,
  station_name: null,
  station_hall: null,
  contact_person: null,
  seq_number: null,
  period_count: null,
  confirmation: null,
  company: null,
  shipped_at: null,
  shipped_quantity: null,
  tracking_no: null,
  shipping_requirement: 'tracking_required',
  handled_quantity: 0,
  package_count: 0,
  fulfillment_status: 'pending',
  packages: [],
  order_id: null,
  order_item_id: null,
  fulfillment_target_id: null,
  source_type: 'manual',
  sync_status: 'synced',
  created_at: '2026-01-20T09:00:00',
  updated_at: '2026-01-20T09:00:00',
}));

const handlers = [
  http.get('/api/issues/18', () => HttpResponse.json(issue)),
  http.get('/api/shipping-waybills/issues/18/draft', () => HttpResponse.json(batch)),
  http.get('/api/shipping-details', () => HttpResponse.json(details)),
  http.patch('/api/shipping-waybills/imports/1/rows/:rowId', () => HttpResponse.json(batch)),
  http.post('/api/shipping-waybills/imports/1/rows', () => HttpResponse.json(batch)),
];

const meta = {
  title: '页面/发行履约/快递管理/运单核对工作台',
  component: WaybillImportWorkbench,
  decorators: [withRouter],
  parameters: {
    layout: 'fullscreen',
    reactRouter: reactRouterParameters({
      routing: { path: '/logistics/issues/:id/waybills/import' },
      location: { pathParams: { id: '18' } },
    }),
    msw: { handlers },
  },
} satisfies Meta<typeof WaybillImportWorkbench>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unresolved: Story = {
  name: '4 行待核对（真实数量示例）',
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('运单核对工作台')).toBeVisible();
    await expect(await canvas.findByText('确认印数基准')).toBeVisible();
    await expect(await canvas.findByText('仍有 366 份待处理，但不会阻止 955 份已匹配数据核销。')).toBeVisible();
  },
};

export const ApiFailure: Story = {
  name: '接口加载失败',
  parameters: {
    msw: {
      handlers: [
        http.get('/api/issues/18', () => HttpResponse.json(issue)),
        http.get('/api/shipping-waybills/issues/18/draft', () => HttpResponse.json({ detail: '读取草稿失败' }, { status: 500 })),
        http.get('/api/shipping-details', () => HttpResponse.json([])),
      ],
    },
  },
};
