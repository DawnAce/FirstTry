import { describe, expect, it } from 'vitest';
import { shippingDetailDisplayColumns } from './recipientShippingColumns';

describe('shippingDetailDisplayColumns', () => {
  it('shows the city column immediately after the address column', () => {
    const keys = shippingDetailDisplayColumns.map((column) => column.key);

    expect(keys.slice(keys.indexOf('address'), keys.indexOf('address') + 2)).toEqual([
      'address',
      'city',
    ]);
  });

  it('renders blank city values as a dash', () => {
    const cityColumn = shippingDetailDisplayColumns.find((column) => column.key === 'city');

    expect(cityColumn?.render?.(null, {} as never, 0)).toBe('-');
    expect(cityColumn?.render?.('北京', {} as never, 0)).toBe('北京');
  });
});
