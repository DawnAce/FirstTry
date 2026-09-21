import type { BatchDeliveryUnit, BatchDeliveryUnits } from '../api/subscription';

export interface UnitEdit {
  row: BatchDeliveryUnit;
  unitId: number;
}

/** 普通 HTTP 的局域网部署也能生成重试标识；getRandomValues 不要求安全上下文。 */
export function distributionRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 用全批次汇总加逐行例外计算变更数，不把“全部”缩小到当前页。 */
export function distributionChanges(data: BatchDeliveryUnits, allUnitId: number | null, edits: Record<number, UnitEdit>) {
  const changes = new Map<string, { key: string; from: string; to: string; count: number }>();
  const name = (id: number | null) => data.units.find((unit) => unit.id === id)?.name
    ?? data.unit_counts.find((unit) => unit.id === id)?.name ?? '待补投递单位';
  const add = (from: number | null, to: number, count: number) => {
    if (from === to) return;
    const key = `${from}-${to}`;
    const row = changes.get(key) ?? { key, from: name(from), to: name(to), count: 0 };
    row.count += count;
    changes.set(key, row);
  };
  if (allUnitId != null) data.unit_counts.forEach((unit) => add(unit.id, allUnitId, unit.count));
  Object.values(edits).forEach(({ row, unitId }) => {
    if (allUnitId != null) add(row.distribution_unit_id, allUnitId, -1);
    add(row.distribution_unit_id, unitId, 1);
  });
  return [...changes.values()].filter((row) => row.count > 0);
}
