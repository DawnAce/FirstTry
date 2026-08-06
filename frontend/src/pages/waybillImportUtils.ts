import type { WaybillImportRow } from '../api/shippingWaybills';

export type RowFilter = 'unresolved' | 'all' | 'matched' | 'manual' | 'invalid' | 'duplicate' | 'no_tracking' | 'ignored';

export const unresolvedStatuses = new Set<WaybillImportRow['match_status']>([
  'unmatched', 'ambiguous', 'duplicate', 'invalid',
]);

export function filterWaybillRows(rows: WaybillImportRow[], filter: RowFilter): WaybillImportRow[] {
  const filtered = rows.filter((row) => {
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
