import { describe, expect, it } from 'vitest';
import { shippingDetailDisplayColumns } from './recipientShippingColumns';

describe('shippingDetailDisplayColumns', () => {
  it('does not show the city column', () => {
    const keys = shippingDetailDisplayColumns.map((column) => column.key);

    expect(keys).toContain('address');
    expect(keys).not.toContain('city');
  });
});
