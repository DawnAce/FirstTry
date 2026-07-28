import { describe, expect, it } from 'vitest';
import { businessCenters, findBusinessCenter, findBusinessModule, isPostalContext } from './businessPortalConfig';

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

  it('uses emoji icons for every sidebar module', () => {
    expect(businessCenters.flatMap((center) => center.modules).every((module) => /[^\u4e00-\u9fff]/u.test(module.icon))).toBe(true);
  });
});
