import { describe, expect, it } from 'vitest';
import { getIssueShippingExportUrl } from './exports';

describe('getIssueShippingExportUrl', () => {
  it('builds the existing shipping export endpoint for an issue', () => {
    expect(getIssueShippingExportUrl(2649)).toBe('/api/issues/2649/export/shipping');
  });
});
