import { describe, expect, it } from 'vitest';
import type { WaybillImportRow } from '../api/shippingWaybills';
import type { ShippingDetail } from '../api/shippingDetails';
import {
  buildWaybillConfirmationNotice,
  buildWaybillGroupSuggestions,
  filterWaybillRows,
  historicalWarehouseStockInImportReason,
  isRecoverableWaybillDraft,
  isSupportedWaybillFilename,
  isWarehouseStockInImportRow,
  remainingPlanGapQuantity,
  recommendedMonthEndGapIds,
  summarizeWaybillRowFilters,
  warehouseStockInImportReason,
} from './waybillImportUtils';

describe('buildWaybillConfirmationNotice', () => {
  it('describes registered month-end deferrals separately from unresolved import rows', () => {
    expect(buildWaybillConfirmationNotice({
      twiceMonthlyDeferredQuantity: 0,
      monthEndDeferredQuantity: 21,
      unexplainedPendingQuantity: 0,
      unresolvedRows: 1,
    })).toBe('21 份已登记为月底合寄，本次不核销，将在目标刊期发出；1 条导入行待核对，确认后仍可继续处理。');
  });

  it('keeps unexplained plan quantities distinct from both deferral types', () => {
    expect(buildWaybillConfirmationNotice({
      twiceMonthlyDeferredQuantity: 2,
      monthEndDeferredQuantity: 3,
      unexplainedPendingQuantity: 4,
      unresolvedRows: 0,
    })).toBe('5 份已登记合寄（每月两次 2 份、月底 3 份），本次不核销，将在目标刊期发出；4 份计划缺口尚未归因。');
  });

  it('uses post-confirmation wording after the matched rows are materialized', () => {
    expect(buildWaybillConfirmationNotice({
      twiceMonthlyDeferredQuantity: 0,
      monthEndDeferredQuantity: 21,
      unexplainedPendingQuantity: 0,
      unresolvedRows: 0,
      confirmed: true,
    })).toBe('21 份已登记为月底合寄，待目标刊期发出。');
  });

  it('uses a completed fallback when nothing remains after confirmation', () => {
    expect(buildWaybillConfirmationNotice({
      twiceMonthlyDeferredQuantity: 0,
      monthEndDeferredQuantity: 0,
      unexplainedPendingQuantity: 0,
      unresolvedRows: 0,
      confirmed: true,
    })).toBe('本批已匹配行均已写入实际发货记录。');
  });
});

const row = (
  id: number,
  matchStatus: WaybillImportRow['match_status'],
  quantity: number,
  noTrackingRequired = false,
): WaybillImportRow => ({
  id,
  source_sheet: '中通',
  source_row: id + 1,
  carrier: noTrackingRequired ? '无需运单' : '中通',
  tracking_no: noTrackingRequired ? null : `7359281752${id.toString().padStart(4, '0')}`,
  recipient_name: `收件人${id}`,
  phone: null,
  address: null,
  quantity,
  no_tracking_required: noTrackingRequired,
  raw_values: [],
  manual_reviewed: false,
  match_status: matchStatus,
  match_reason: null,
  shipping_detail_id: matchStatus === 'matched' ? id : null,
  consolidation_deferral_ids: null,
  consolidation_issue_numbers: null,
  consolidation_quantity: 0,
  consolidation_candidate: false,
});

describe('filterWaybillRows', () => {
  const rows = [
    row(1, 'matched', 1),
    row(2, 'invalid', 10),
    row(3, 'unmatched', 300),
    row(4, 'duplicate', 50),
    row(5, 'ignored', 8),
    row(6, 'matched', 299, true),
    {
      ...row(7, 'ignored', 70, true),
      match_reason: warehouseStockInImportReason,
      shipping_detail_id: 7,
    },
    {
      ...row(8, 'ignored', 72, true),
      match_reason: historicalWarehouseStockInImportReason,
      shipping_detail_id: 8,
    },
  ];

  it('focuses unresolved rows and sorts by affected quantity', () => {
    expect(filterWaybillRows(rows, 'unresolved').map((item) => item.id)).toEqual([3, 4, 2]);
  });

  it('keeps ignored rows out of unresolved work', () => {
    expect(filterWaybillRows(rows, 'ignored').map((item) => item.id)).toEqual([5]);
  });

  it('classifies converted warehouse rows as stock-in rather than ignored', () => {
    expect(filterWaybillRows(rows, 'warehouse_stock_in').map((item) => item.id)).toEqual([8, 7]);
    expect(isWarehouseStockInImportRow(rows[6])).toBe(true);
    expect(isWarehouseStockInImportRow(rows[7])).toBe(true);
  });

  it('keeps tracking-mode filters inside matched rows', () => {
    expect(filterWaybillRows(rows, 'no_tracking').map((item) => item.id)).toEqual([6]);
    expect(filterWaybillRows(rows, 'tracked').map((item) => item.id)).toEqual([1]);
    expect(filterWaybillRows([
      ...rows,
      { ...row(9, 'invalid', 1, true), match_reason: '缺少运单号' },
    ], 'no_tracking').map((item) => item.id)).toEqual([6]);
  });

  it('keeps primary statuses mutually exclusive and child filters inside their parent', () => {
    expect(summarizeWaybillRowFilters(rows)).toEqual({
      all: 8,
      matched: 2,
      tracked: 1,
      noTracking: 1,
      unresolved: 3,
      manual: 1,
      invalid: 1,
      duplicate: 1,
      warehouseStockIn: 2,
      ignored: 1,
    });
  });

  it('groups split packages when one plan detail has the same recipient and remaining quantity', () => {
    const splitRows = [
      { ...row(11, 'unmatched', 65), recipient_name: '肖波' },
      { ...row(12, 'unmatched', 100), recipient_name: '肖波' },
      { ...row(13, 'unmatched', 100), recipient_name: '肖波' },
      { ...row(14, 'unmatched', 100), recipient_name: '肖波' },
    ];
    const detail = {
      id: 713,
      name: '肖波',
      quantity: 365,
      handled_quantity: 0,
    } as ShippingDetail;
    expect(buildWaybillGroupSuggestions(splitRows, [detail])).toEqual([{
      shippingDetailId: 713,
      rowIds: [11, 12, 13, 14],
      recipientName: '肖波',
      detailQuantity: 365,
      rowQuantity: 365,
    }]);
  });
});

describe('isSupportedWaybillFilename', () => {
  it('accepts supported Excel files case-insensitively', () => {
    expect(isSupportedWaybillFilename('运单.xlsx')).toBe(true);
    expect(isSupportedWaybillFilename('运单.XLSM')).toBe(true);
  });

  it('rejects other files and misleading suffixes', () => {
    expect(isSupportedWaybillFilename('运单.xls')).toBe(false);
    expect(isSupportedWaybillFilename('运单.xlsx.pdf')).toBe(false);
  });
});

describe('isRecoverableWaybillDraft', () => {
  it('recovers a newly created forced-reparse batch for the same file', () => {
    expect(isRecoverableWaybillDraft(
      { id: 6, filename: '单号-中国经营报5-18日.xlsx' },
      '单号-中国经营报5-18日.xlsx',
      5,
      true,
    )).toBe(true);
  });

  it('does not mistake the previous forced-reparse draft for a completed replacement', () => {
    expect(isRecoverableWaybillDraft(
      { id: 5, filename: '单号-中国经营报5-18日.xlsx' },
      '单号-中国经营报5-18日.xlsx',
      5,
      true,
    )).toBe(false);
  });
});

describe('recommendedMonthEndGapIds', () => {
  it('selects only unresolved month-end detail gaps', () => {
    expect(recommendedMonthEndGapIds([
      { shipping_detail_id: 1, suggested_month_end: true, remaining_quantity: 3 },
      { shipping_detail_id: 2, suggested_month_end: true, remaining_quantity: 0 },
      { shipping_detail_id: 3, suggested_month_end: false, remaining_quantity: 1 },
    ])).toEqual([1]);
  });
});

describe('remainingPlanGapQuantity', () => {
  it('uses the detail-level remaining quantities without deducting stock-in twice', () => {
    expect(remainingPlanGapQuantity([
      { remaining_quantity: 4 },
      { remaining_quantity: 3 },
      ...Array.from({ length: 17 }, () => ({ remaining_quantity: 1 })),
      { remaining_quantity: 0 },
    ])).toBe(24);
  });
});
