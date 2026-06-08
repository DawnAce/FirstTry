import { describe, expect, it } from 'vitest';
import { shippingDetailDisplayColumns } from './recipientShippingColumns';

describe('shippingDetailDisplayColumns', () => {
  it('does not show the city column', () => {
    const keys = shippingDetailDisplayColumns.map((column) => column.key);

    expect(keys).toContain('address');
    expect(keys).not.toContain('city');
  });

  it('shows shipping source and sync status after company', () => {
    const keys = shippingDetailDisplayColumns.map((column) => column.key);

    expect(keys).toContain('source_type');
    expect(keys).toContain('sync_status');
    expect(keys.slice(keys.indexOf('company') + 1, keys.indexOf('company') + 3)).toEqual([
      'source_type',
      'sync_status',
    ]);
  });
});
