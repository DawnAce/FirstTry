import type { WaybillImportRow } from '../api/shippingWaybills';
import type { ShippingDetail } from '../api/shippingDetails';

export type RowFilter = 'unresolved' | 'gap' | 'all' | 'matched' | 'manual' | 'invalid' | 'duplicate' | 'no_tracking' | 'ignored';

export const unresolvedStatuses = new Set<WaybillImportRow['match_status']>([
  'unmatched', 'ambiguous', 'duplicate', 'invalid',
]);

export function filterWaybillRows(rows: WaybillImportRow[], filter: RowFilter): WaybillImportRow[] {
  const filtered = rows.filter((row) => {
    if (filter === 'gap') return false;
    if (filter === 'all') return true;
    if (filter === 'unresolved') return unresolvedStatuses.has(row.match_status);
    if (filter === 'matched') return row.match_status === 'matched';
    if (filter === 'manual') return row.match_status === 'unmatched' || row.match_status === 'ambiguous';
    if (filter === 'invalid') return row.match_status === 'invalid';
    if (filter === 'duplicate') return row.match_status === 'duplicate';
    if (filter === 'no_tracking') return row.no_tracking_required;
    return row.match_status === 'ignored';
  });
  return [...filtered].sort((a, b) => {
    const aAttention = unresolvedStatuses.has(a.match_status) ? 0 : 1;
    const bAttention = unresolvedStatuses.has(b.match_status) ? 0 : 1;
    return aAttention - bAttention || b.quantity - a.quantity || a.id - b.id;
  });
}

export interface WaybillGroupSuggestion {
  shippingDetailId: number;
  rowIds: number[];
  recipientName: string;
  detailQuantity: number;
  rowQuantity: number;
}

const normalizedName = (value: string) => value.trim().toLowerCase().replace(/[^0-9a-z\u4e00-\u9fff]/g, '');

export function buildWaybillGroupSuggestions(
  rows: WaybillImportRow[],
  details: ShippingDetail[],
): WaybillGroupSuggestion[] {
  const grouped = new Map<string, WaybillImportRow[]>();
  rows.filter((row) => unresolvedStatuses.has(row.match_status) && row.quantity > 0).forEach((row) => {
    const key = normalizedName(row.recipient_name);
    if (!key) return;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  });

  const suggestions: WaybillGroupSuggestion[] = [];
  grouped.forEach((groupRows, nameKey) => {
    const rowQuantity = groupRows.reduce((sum, row) => sum + row.quantity, 0);
    const candidates = details.filter((detail) => (
      normalizedName(detail.name) === nameKey
      && Math.max(detail.quantity - detail.handled_quantity, 0) === rowQuantity
    ));
    if (candidates.length !== 1) return;
    suggestions.push({
      shippingDetailId: candidates[0].id,
      rowIds: groupRows.map((row) => row.id),
      recipientName: candidates[0].name,
      detailQuantity: candidates[0].quantity,
      rowQuantity,
    });
  });
  return suggestions.sort((a, b) => b.rowQuantity - a.rowQuantity);
}
