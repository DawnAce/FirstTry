import { describe, expect, it } from 'vitest';
import type { ShippingDetail } from '../api/shippingDetails';
import { getPackageCopy } from './shippingDetailCardUtils';

const detail = (overrides: Partial<ShippingDetail>): ShippingDetail => ({
  quantity: 10,
  handled_quantity: 0,
  package_count: 0,
  fulfillment_status: 'pending',
  shipping_requirement: 'tracking_required',
  ...overrides,
} as ShippingDetail);

describe('getPackageCopy', () => {
  it('does not repeat completion copy when all package quantities are reconciled', () => {
    expect(getPackageCopy(detail({
      quantity: 365,
      handled_quantity: 365,
      package_count: 4,
      fulfillment_status: 'shipped',
    }))).toEqual({ title: '4 个包裹', detail: null });
  });

  it('does not repeat system reconciliation copy for no-tracking details', () => {
    expect(getPackageCopy(detail({
      quantity: 74,
      handled_quantity: 74,
      fulfillment_status: 'no_tracking_required',
      shipping_requirement: 'no_tracking_required',
    }))).toEqual({ title: '无需运单', detail: null });
  });

  it('keeps the remaining quantity for partially reconciled details', () => {
    expect(getPackageCopy(detail({
      quantity: 365,
      handled_quantity: 300,
      package_count: 3,
      fulfillment_status: 'partial',
    }))).toEqual({ title: '3 个包裹', detail: '还差 65 份' });
  });
});
