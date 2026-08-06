import { describe, expect, it } from 'vitest';
import type { WaybillImportRow } from '../api/shippingWaybills';
import { filterWaybillRows } from './waybillImportUtils';

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
});
