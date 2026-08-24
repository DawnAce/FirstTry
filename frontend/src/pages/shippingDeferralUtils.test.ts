import { describe, expect, it } from 'vitest';
import type { ShippingDeferral } from '../api/shippingWaybills';
import { deferralsForTargetIssue, summarizeShippingDeferrals } from './shippingDeferralUtils';

const deferral = (id: number, overrides: Partial<ShippingDeferral> = {}): ShippingDeferral => ({
  id,
  issue_id: id,
  issue_number: 2600 + id,
  shipping_detail_id: id,
  deferral_type: 'month_end_consolidation',
  target_issue_number: 2649,
  target_publish_date: '2026-04-27',
  consolidation_batch: '2026-04-month_end',
  quantity: 1,
  reason: '月底合寄',
  status: 'pending',
  fulfilled_package_id: null,
  detail_name_snapshot: `收件人${id}`,
  detail_phone_snapshot: null,
  detail_address_snapshot: null,
  detail_channel_snapshot: '个人订阅',
  created_by: 1,
  created_at: '2026-04-06T09:00:00',
  fulfilled_at: null,
  ...overrides,
});

describe('deferralsForTargetIssue', () => {
  it('shows only the exact target issue and excludes overdue or unbatched history', () => {
    const items = [
      deferral(1),
      deferral(2, { target_issue_number: 2648, target_publish_date: '2026-04-20' }),
      deferral(3, { target_issue_number: null, target_publish_date: '2026-04-27' }),
      deferral(4, { target_issue_number: null, target_publish_date: null, consolidation_batch: null }),
    ];

    expect(deferralsForTargetIssue(items, 2649, '2026-04-27').map((item) => item.id)).toEqual([1, 3]);
  });
});

describe('summarizeShippingDeferrals', () => {
  it('separates global backlog counts from copy quantity and legacy rows', () => {
    const summary = summarizeShippingDeferrals([
      deferral(1, { quantity: 4, target_publish_date: '2026-04-27' }),
      deferral(2, {
        quantity: 1,
        deferral_type: 'twice_monthly_consolidation',
        target_publish_date: '2026-05-11',
      }),
      deferral(3, {
        quantity: 3,
        target_issue_number: null,
        target_publish_date: null,
        consolidation_batch: null,
      }),
    ], '2026-05-01');

    expect(summary).toEqual({
      recordCount: 3,
      quantity: 8,
      twiceMonthlyCount: 1,
      monthEndCount: 2,
      overdueCount: 1,
      legacyCount: 1,
    });
  });
});
