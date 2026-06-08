import { isValidElement } from 'react';
import { describe, expect, it } from 'vitest';
import type { ShippingDetail } from '../api/shippingDetails';
import { shippingDetailDisplayColumns } from './recipientShippingColumns';

const renderColumn = (key: string, value: unknown) => {
  const column = shippingDetailDisplayColumns.find((item) => item.key === key);

  if (!column || !('render' in column) || typeof column.render !== 'function') {
    throw new Error(`Column ${key} does not have a render function`);
  }

  return column.render(value, {} as ShippingDetail, 0);
};

const expectPlainText = (node: React.ReactNode, text: string) => {
  expect(node).toBe(text);
};

const expectTag = (node: React.ReactNode, text: string, color: string) => {
  expect(isValidElement(node)).toBe(true);

  if (!isValidElement<{ children?: React.ReactNode; color?: string }>(node)) {
    throw new Error('Expected a React element');
  }

  expect(node.props.children).toBe(text);
  expect(node.props.color).toBe(color);
};

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

  it.each([null, undefined, ''])('renders empty source_type as fallback for %s', (value) => {
    expectPlainText(renderColumn('source_type', value), '-');
  });

  it('renders unknown source_type visibly with neutral color', () => {
    expectTag(renderColumn('source_type', 'legacy_import'), 'legacy_import', 'default');
  });

  it.each([
    ['manual', '手工', 'default'],
    ['order_generated', '订单生成', 'blue'],
    ['historical_import', '历史导入', 'default'],
  ])('preserves source_type label and color for %s', (value, label, color) => {
    expectTag(renderColumn('source_type', value), label, color);
  });

  it.each([null, undefined, ''])('renders empty sync_status as fallback for %s', (value) => {
    expectPlainText(renderColumn('sync_status', value), '-');
  });

  it('renders unknown sync_status visibly with neutral color', () => {
    expectTag(renderColumn('sync_status', 'legacy_status'), 'legacy_status', 'default');
  });

  it.each([
    ['synced', '已同步', 'green'],
    ['manually_modified', '人工修改', 'orange'],
    ['orphaned', '孤立', 'red'],
  ])('preserves sync_status label and color for %s', (value, label, color) => {
    expectTag(renderColumn('sync_status', value), label, color);
  });
});
