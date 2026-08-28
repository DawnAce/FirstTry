import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent } from 'storybook/test';
import { HttpResponse, http } from 'msw';
import { reactRouterParameters, withRouter } from 'storybook-addon-remix-react-router';
import WaybillImportWorkbench from './WaybillImportWorkbench';
import type { ShippingGapDetail, WaybillImportBatch, WaybillImportRow } from '../api/shippingWaybills';
import { warehouseStockInImportReason } from './waybillImportUtils';

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
  makeRow(101, 'unmatched', 65, { recipient_name: '肖波', phone: '15719468023', address: '成都市双流文星镇通关路86号A1－A4杂志铺' }),
  makeRow(102, 'unmatched', 100, { recipient_name: '肖波', phone: '15719468023', address: '成都市双流文星镇通关路86号A1－A4杂志铺' }),
  makeRow(103, 'unmatched', 100, { recipient_name: '肖波', phone: '15719468023', address: '成都市双流文星镇通关路86号A1－A4杂志铺' }),
  makeRow(104, 'unmatched', 100, { recipient_name: '肖波', phone: '15719468023', address: '成都市双流文星镇通关路86号A1－A4杂志铺' }),
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
  unresolved_quantity: 365,
  file_gap_quantity: 1,
  created_at: '2026-01-26T15:30:00',
  confirmed_at: null,
  rows: [...matchedRows, ...unresolvedRows],
};

const confirmedBatch: WaybillImportBatch = {
  ...batch,
  status: 'confirmed',
  confirmed_at: '2026-01-26T16:00:00',
};

const gapRegressionBatch: WaybillImportBatch = {
  ...batch,
  id: 2,
  expected_quantity: 1421,
  parsed_quantity: 1325,
  matched_quantity: 1325,
  pending_quantity: 96,
  matched_rows: 55,
  unmatched_rows: 0,
  unresolved_quantity: 0,
  file_gap_quantity: 96,
  rows: matchedRows,
};

const warehouseStockInRow = makeRow(201, 'ignored', 70, {
  carrier: '无需运单',
  tracking_no: null,
  recipient_name: '中通库房',
  phone: null,
  address: '库房暂存',
  no_tracking_required: true,
  manual_reviewed: true,
  match_reason: warehouseStockInImportReason,
  shipping_detail_id: 201,
});

const warehouseStockInBatch: WaybillImportBatch = {
  ...batch,
  id: 3,
  expected_quantity: 1025,
  parsed_quantity: 1025,
  matched_quantity: 955,
  pending_quantity: 0,
  matched_rows: 55,
  unmatched_rows: 0,
  warning_count: 0,
  unresolved_quantity: 0,
  file_gap_quantity: 0,
  rows: [...matchedRows, warehouseStockInRow],
};

const gapRegressionDetails: ShippingGapDetail[] = Array.from({ length: 19 }, (_, index) => ({
  shipping_detail_id: 300 + index,
  name: `月底收件人 ${index + 1}`,
  phone: `1380001${String(index).padStart(4, '0')}`,
  address: `北京市示例地址 ${index + 1} 号`,
  channel: '个人订阅',
  sheet_name: '月底-整月',
  frequency: '月',
  planned_quantity: index === 0 ? 4 : index === 1 ? 3 : 1,
  source_quantity: 0,
  deferred_quantity: 0,
  twice_monthly_deferred_quantity: 0,
  month_end_deferred_quantity: 0,
  remaining_quantity: index === 0 ? 4 : index === 1 ? 3 : 1,
  suggested_month_end: true,
  required_adjustment_type: null,
}));

const details = [
  { id: 1, name: '收件人 1', phone: '13800000001', address: '北京市朝阳区示例路 1 号', quantity: 10 },
  { id: 201, name: '库房', phone: '13900000000', address: '中通库房', quantity: 74 },
  { id: 202, name: '社用报', phone: '13900000001', address: '报社', quantity: 225 },
  { id: 203, name: '发行部', phone: '13800000102', address: '北京市朝阳区示例路 102 号', quantity: 30 },
  { id: 204, name: '发行部', phone: '13800000102', address: '北京市朝阳区示例路 102 号', quantity: 20 },
  { id: 205, name: '肖波', phone: '15719468023', address: '成都市双流文星镇通关路86号A1－A4杂志铺', quantity: 365 },
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
  created_at: '2026-01-20T09:00:00',
  updated_at: '2026-01-20T09:00:00',
}));

const handlers = [
  http.get('/api/issues/18', () => HttpResponse.json(issue)),
  http.get('/api/issues/18/report', () => HttpResponse.json({
    issue_id: 18,
    issue_number: 2638,
    entries: [],
    total: 1321,
    destination_summary: [],
    shipping_check: { is_match: false, report_zt_total: 1321, shipping_total: 1320, delta: 1 },
    confirmation_summary: {
      confirmed_report_total: 1321,
      confirmed_shipping_total: 1320,
      confirmed_delta: 1,
      confirmed_is_match: false,
      current_shipping_total: 1320,
      current_delta: 1,
      current_is_match: false,
      has_shipping_drift: false,
      plan_delta: -1,
      plan_is_match: false,
      plan_attributed_quantity: 0,
      plan_unexplained_delta: -1,
      plan_is_reconciled: false,
      unattributed_adjustment_quantity: 0,
    },
  })),
  http.get('/api/shipping-waybills/issues/18/draft', () => HttpResponse.json(batch)),
  http.get('/api/shipping-waybills/issues/18/summary', () => HttpResponse.json({
    issue_id: 18,
    issue_number: 2638,
    expected_quantity: 1321,
    planned_quantity: 1320,
    handled_quantity: 955,
    tracked_quantity: 656,
    no_tracking_quantity: 299,
    actual_shipped_quantity: 955,
    adjustment_quantity: 0,
    no_shipment_quantity: 0,
    warehouse_stock_in_quantity: 0,
    deferred_quantity: 0,
    twice_monthly_deferred_quantity: 0,
    month_end_deferred_quantity: 0,
    unexplained_pending_quantity: 0,
    attributed_adjustment_quantity: 0,
    unattributed_adjustment_quantity: 0,
    pending_quantity: 366,
    extra_quantity: 0,
    package_count: 53,
    pending_detail_count: 1,
    status: 'partial',
    shipment_status: 'partial',
    latest_import: batch,
    adjustments: [],
    deferrals: [],
    gap_details: [],
  })),
  http.get('/api/shipping-waybills/deferrals/pending', () => HttpResponse.json([])),
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
    await expect(await canvas.findByText('发货计划对账')).toBeVisible();
    await expect(await canvas.findByText('未解释待补')).toBeVisible();
    await expect(await canvas.findByRole('button', { name: /^待核对\s*4行/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(await canvas.findByRole('button', { name: /待人工匹配\s*4行/ })).toBeVisible();
    const linkButton = await canvas.findByRole('button', { name: /关联这 4 个运单/ });
    await expect(linkButton).toBeVisible();
    await expect(getComputedStyle(linkButton).color).toBe('rgb(255, 255, 255)');
    await userEvent.click(await canvas.findByRole('button', { name: /已匹配\s*55行/ }));
    await expect(await canvas.findByRole('button', { name: /有运单\s*55行/ })).toBeVisible();
    await expect(await canvas.findByRole('button', { name: /无需运单\s*0行/ })).toBeVisible();
    const confirmButton = await canvas.findByRole('button', { name: /确认导入并核销 955 份/ });
    await expect(confirmButton).toBeVisible();
    await expect(getComputedStyle(confirmButton.lastElementChild!).color).toBe('rgb(255, 255, 255)');
  },
};

export const ConfirmedWithPending: Story = {
  name: '已确认并保留待处理行',
  parameters: {
    msw: {
      handlers: [
        http.get('/api/shipping-waybills/issues/18/draft', () => HttpResponse.json(confirmedBatch)),
        ...handlers,
      ],
    },
  },
  play: async ({ canvas }) => {
    const returnButtons = await canvas.findAllByRole('button', { name: /返回第 2638 期快递管理/ });
    const returnButton = returnButtons.find((button) => button.classList.contains('waybill-return-button'))!;
    await expect(returnButton).toBeVisible();
    await expect(getComputedStyle(returnButton).color).toBe('rgb(255, 255, 255)');
    await expect(getComputedStyle(returnButton).backgroundColor).toBe('rgb(0, 113, 227)');
  },
};

export const StockInAndPlanGap: Story = {
  name: '转库留存后仍显示 24 份计划缺口',
  parameters: {
    msw: {
      handlers: [
        http.get('/api/shipping-waybills/issues/18/draft', () => HttpResponse.json(gapRegressionBatch)),
        http.get('/api/shipping-waybills/issues/18/summary', () => HttpResponse.json({
          issue_id: 18,
          issue_number: 2638,
          expected_quantity: 1421,
          planned_quantity: 1421,
          handled_quantity: 1397,
          tracked_quantity: 1325,
          no_tracking_quantity: 0,
          actual_shipped_quantity: 1325,
          adjustment_quantity: 72,
          no_shipment_quantity: 0,
          warehouse_stock_in_quantity: 72,
          deferred_quantity: 0,
          twice_monthly_deferred_quantity: 0,
          month_end_deferred_quantity: 0,
          unexplained_pending_quantity: 24,
          attributed_adjustment_quantity: 72,
          unattributed_adjustment_quantity: 0,
          pending_quantity: 24,
          extra_quantity: 0,
          package_count: 55,
          pending_detail_count: 19,
          status: 'partial',
          shipment_status: 'partial',
          latest_import: gapRegressionBatch,
          adjustments: [],
          deferrals: [],
          gap_details: gapRegressionDetails,
        })),
        ...handlers,
      ],
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('button', { name: /计划缺口\s*24份/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(await canvas.findByText(/计划缺口 24 份/)).toBeVisible();
    await expect((await canvas.findAllByText('待确认'))[0]).toBeVisible();
    await expect((await canvas.findAllByText('月底合寄'))[0]).toBeVisible();
  },
};

export const WarehouseStockInClassification: Story = {
  name: '转库留存与人工忽略分开显示',
  parameters: {
    msw: {
      handlers: [
        http.get('/api/shipping-waybills/issues/18/draft', () => HttpResponse.json(warehouseStockInBatch)),
        http.get('/api/shipping-waybills/issues/18/summary', () => HttpResponse.json({
          issue_id: 18,
          issue_number: 2638,
          expected_quantity: 1025,
          planned_quantity: 1025,
          handled_quantity: 1025,
          tracked_quantity: 955,
          no_tracking_quantity: 0,
          actual_shipped_quantity: 955,
          adjustment_quantity: 70,
          no_shipment_quantity: 0,
          warehouse_stock_in_quantity: 70,
          deferred_quantity: 0,
          twice_monthly_deferred_quantity: 0,
          month_end_deferred_quantity: 0,
          unexplained_pending_quantity: 0,
          attributed_adjustment_quantity: 70,
          unattributed_adjustment_quantity: 0,
          pending_quantity: 0,
          extra_quantity: 0,
          package_count: 55,
          pending_detail_count: 0,
          status: 'shipped',
          shipment_status: 'partial',
          latest_import: warehouseStockInBatch,
          adjustments: [],
          deferrals: [],
          gap_details: [],
        })),
        ...handlers,
      ],
    },
  },
  play: async ({ canvas }) => {
    const stockInFilter = await canvas.findByRole('button', { name: /转库留存\s*1行/ });
    await expect(stockInFilter).toBeVisible();
    await expect(await canvas.findByRole('button', { name: /已忽略\s*0行/ })).toBeVisible();
    await userEvent.click(stockInFilter);
    await expect(await canvas.findByText('转库留存 1行')).toBeVisible();
    await expect(await canvas.findByText(/本期不寄给最终收件人/)).toBeVisible();
    await expect(await canvas.findByText('已转库留存')).toBeVisible();
    await expect(await canvas.findByText('已入中通库房，本期不生成运单')).toBeVisible();
    await expect(await canvas.findByText('已入库')).toBeVisible();
    await expect(canvas.queryByRole('button', { name: '恢复' })).not.toBeInTheDocument();
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
