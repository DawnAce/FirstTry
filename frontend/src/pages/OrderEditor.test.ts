import { describe, expect, it } from 'vitest';
import { extractFormValidation } from './OrderEditor';

describe('extractFormValidation', () => {
  it('keeps the concrete message and field path returned by Ant Design', () => {
    expect(
      extractFormValidation({
        errorFields: [
          {
            name: ['items'],
            errors: ['至少添加 1 条订单明细'],
          },
        ],
      }),
    ).toEqual({
      fields: [{ name: ['items'], errors: ['至少添加 1 条订单明细'] }],
      messages: ['至少添加 1 条订单明细'],
    });
  });
});
