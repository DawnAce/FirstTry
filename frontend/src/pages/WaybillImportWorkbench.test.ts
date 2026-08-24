import { describe, expect, it } from 'vitest';
import type { WaybillImportRow } from '../api/shippingWaybills';
import type { ShippingDetail } from '../api/shippingDetails';
import {
  buildWaybillGroupSuggestions,
  filterWaybillRows,
  isRecoverableWaybillDraft,
  isSupportedWaybillFilename,
  remainingPlanGapQuantity,
  recommendedMonthEndGapIds,
} from './waybillImportUtils';

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
});

describe('filterWaybillRows', () => {
  const rows = [
    row(1, 'matched', 1),
    row(2, 'invalid', 10),
    row(3, 'unmatched', 300),
    row(4, 'duplicate', 50),
    row(5, 'ignored', 8),
    row(6, 'matched', 299, true),
  ];

  it('focuses unresolved rows and sorts by affected quantity', () => {
    expect(filterWaybillRows(rows, 'unresolved').map((item) => item.id)).toEqual([3, 4, 2]);
  });

  it('keeps ignored rows out of unresolved work', () => {
    expect(filterWaybillRows(rows, 'ignored').map((item) => item.id)).toEqual([5]);
  });

  it('can isolate no-tracking rows independently of match status', () => {
    expect(filterWaybillRows(rows, 'no_tracking').map((item) => item.id)).toEqual([6]);
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
