import { describe, expect, it } from 'vitest';
import {
  businessCenters,
  findBusinessCenter,
  findBusinessModule,
  findCourierFunction,
  findPostalFunction,
  isCourierContext,
  isPostalContext,
  courierFunctions,
  postalFunctions,
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

  it('maps postal pages to the correct expanded navigation child', () => {
    expect(isPostalContext('/business/fulfilment/postal')).toBe(true);
    expect(isPostalContext('/post-delivery/deliveries')).toBe(true);
    expect(isPostalContext('/recipients')).toBe(false);
    expect(findPostalFunction('/post-delivery/deliveries')?.title).toBe('投递明细');
    expect(findPostalFunction('/post-delivery/renewals')?.title).toBe('待续投');
    expect(findPostalFunction('/post-delivery/subscription')?.title).toBe('订报转投');
    expect(findPostalFunction('/post-delivery/tickets')?.title).toBe('邮局工单');
  });

  it('defines both fulfilment modules as child navigation groups', () => {
    expect(postalFunctions.map((item) => item.title)).toEqual(['投递明细', '待续投', '订报转投', '邮局工单']);
    expect(courierFunctions.map((item) => item.title)).toEqual(['发货计划', '实际发货']);
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
