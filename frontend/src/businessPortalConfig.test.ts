import { describe, expect, it } from 'vitest';
import {
  businessCenters,
  findBusinessCenter,
  findBusinessModule,
  findCourierFunction,
  isCourierContext,
  isPostalContext,
} from './businessPortalConfig';

describe('business portal route ownership', () => {
  it.each([
    ['/print', 'planning', 'print'],
    ['/schedule/import', 'planning', 'schedule'],
    ['/post-delivery/tickets', 'fulfilment', 'postal'],
    ['/logistics/issues/12', 'fulfilment', 'courier'],
    ['/orders/42/edit', 'commerce', 'orders'],
    ['/contracts', 'finance', 'contracts'],
    ['/analytics', 'analytics', 'campaigns'],
  ])('maps %s to %s/%s', (path, centerKey, moduleKey) => {
    const center = findBusinessCenter(path);
    expect(center?.key).toBe(centerKey);
    expect(findBusinessModule(center, path)?.key).toBe(moduleKey);
  });

  it('keeps postal pages in their third-level context', () => {
    expect(isPostalContext('/business/fulfilment/postal')).toBe(true);
    expect(isPostalContext('/post-delivery/deliveries')).toBe(true);
    expect(isPostalContext('/recipients')).toBe(false);
  });

  it('maps courier pages and detail routes to the correct second-level navigation', () => {
    expect(isCourierContext('/logistics/plans')).toBe(true);
    expect(findCourierFunction('/logistics/plans')?.title).toBe('发货计划');
    expect(findCourierFunction('/logistics/shipments')?.title).toBe('实际发货');
    expect(findCourierFunction('/logistics/issues/12', '?section=plan')?.title).toBe('发货计划');
    expect(findCourierFunction('/logistics/issues/12', '?section=actual')?.title).toBe('实际发货');
    expect(findCourierFunction('/logistics/issues/12/waybills/import')?.title).toBe('实际发货');
  });

  it('uses emoji icons for every sidebar module', () => {
    expect(businessCenters.flatMap((center) => center.modules).every((module) => /[^\u4e00-\u9fff]/u.test(module.icon))).toBe(true);
  });
});
