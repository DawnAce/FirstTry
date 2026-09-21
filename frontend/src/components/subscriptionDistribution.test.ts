import { describe, expect, it, vi } from 'vitest';
import type { BatchDeliveryUnit, BatchDeliveryUnits } from '../api/subscription';
import { distributionChanges, distributionRequestId } from './subscriptionDistribution';

const data: BatchDeliveryUnits = {
  active_version_id: 1, snapshot: 'test', total: 102, rows: [],
  units: [{ id: 1, name: '北京' }, { id: 2, name: '广东' }],
  unit_counts: [{ id: 1, name: '北京', count: 50 }, { id: 2, name: '广东', count: 51 }, { id: null, name: '待补投递单位', count: 1 }],
};
const row = (id: number, unit: number | null): BatchDeliveryUnit => ({
  id, year: 2026, delivery_no: String(id), recipient_name: '测试读者', recipient_province: null,
  recipient_city: null, recipient_district: null, copies: 1, distribution_unit_id: unit, distribution_unit_name: null,
});

describe('投递单位变更汇总', () => {
  it('普通 HTTP 环境没有 randomUUID 时仍生成有效且独立的请求标识', () => {
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal('crypto', { getRandomValues });
    try {
      const first = distributionRequestId();
      expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(distributionRequestId()).not.toBe(first);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('全批次跨页计算，只计实际变化的记录', () => {
    expect(distributionChanges(data, 1, {})).toEqual([
      { key: '2-1', from: '广东', to: '北京', count: 51 },
      { key: 'null-1', from: '待补投递单位', to: '北京', count: 1 },
    ]);
  });
  it('全批次统一后，逐条例外可以保持原单位或更改方向', () => {
    const result = distributionChanges(data, 1, { 1: { row: row(1, 2), unitId: 2 }, 2: { row: row(2, 1), unitId: 2 } });
    expect(result).toEqual([
      { key: '2-1', from: '广东', to: '北京', count: 50 },
      { key: 'null-1', from: '待补投递单位', to: '北京', count: 1 },
      { key: '1-2', from: '北京', to: '广东', count: 1 },
    ]);
  });
  it('仅选中记录变化，撤销后没有待提交变更', () => {
    expect(distributionChanges(data, null, { 102: { row: row(102, null), unitId: 1 } })).toEqual([
      { key: 'null-1', from: '待补投递单位', to: '北京', count: 1 },
    ]);
    expect(distributionChanges(data, null, {})).toEqual([]);
  });
});
