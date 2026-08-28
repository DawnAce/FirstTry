import type { ShippingGapDetail, WaybillImportBatch, WaybillImportRow } from '../api/shippingWaybills';
import type { ShippingDetail } from '../api/shippingDetails';

export type RowFilter = 'unresolved' | 'gap' | 'all' | 'matched' | 'tracked' | 'manual' | 'invalid' | 'duplicate' | 'no_tracking' | 'warehouse_stock_in' | 'ignored';

export const warehouseStockInImportReason = '已转换：马飞—库房留存改按转库留存/库存入库核销';
export const historicalWarehouseStockInImportReason = '历史转换：马飞—库房留存已改为转库留存/库存入库';

const warehouseStockInImportReasons = new Set([
  warehouseStockInImportReason,
  historicalWarehouseStockInImportReason,
]);

export function isWarehouseStockInImportRow(row: WaybillImportRow): boolean {
  return row.match_status === 'ignored'
    && row.match_reason !== null
    && warehouseStockInImportReasons.has(row.match_reason);
}

interface WaybillConfirmationNoticeInput {
  twiceMonthlyDeferredQuantity: number;
  monthEndDeferredQuantity: number;
  unexplainedPendingQuantity: number;
  unresolvedRows: number;
  confirmed?: boolean;
}

export function buildWaybillConfirmationNotice({
  twiceMonthlyDeferredQuantity,
  monthEndDeferredQuantity,
  unexplainedPendingQuantity,
  unresolvedRows,
  confirmed = false,
}: WaybillConfirmationNoticeInput): string {
  const sentences: string[] = [];
  const deferredQuantity = twiceMonthlyDeferredQuantity + monthEndDeferredQuantity;
  const deferredAction = confirmed ? '待目标刊期发出' : '本次不核销，将在目标刊期发出';

  if (twiceMonthlyDeferredQuantity > 0 && monthEndDeferredQuantity > 0) {
    sentences.push(
      `${deferredQuantity.toLocaleString()} 份已登记合寄（每月两次 ${twiceMonthlyDeferredQuantity.toLocaleString()} 份、月底 ${monthEndDeferredQuantity.toLocaleString()} 份），${deferredAction}`,
    );
  } else if (twiceMonthlyDeferredQuantity > 0) {
    sentences.push(`${twiceMonthlyDeferredQuantity.toLocaleString()} 份已登记为每月两次合寄，${deferredAction}`);
  } else if (monthEndDeferredQuantity > 0) {
    sentences.push(`${monthEndDeferredQuantity.toLocaleString()} 份已登记为月底合寄，${deferredAction}`);
  }

  if (unexplainedPendingQuantity > 0) {
    sentences.push(`${unexplainedPendingQuantity.toLocaleString()} 份计划缺口${confirmed ? '仍未归因' : '尚未归因'}`);
  }
  if (unresolvedRows > 0) {
    sentences.push(`${unresolvedRows.toLocaleString()} 条导入行待核对${confirmed ? '，可继续处理' : '，确认后仍可继续处理'}`);
  }

  if (sentences.length) return `${sentences.join('；')}。`;
  return confirmed ? '本批已匹配行均已写入实际发货记录。' : '已匹配行将写入实际发货记录。';
}

export const unresolvedStatuses = new Set<WaybillImportRow['match_status']>([
  'unmatched', 'ambiguous', 'duplicate', 'invalid',
]);

export interface WaybillRowFilterCounts {
  all: number;
  matched: number;
  tracked: number;
  noTracking: number;
  unresolved: number;
  manual: number;
  invalid: number;
  duplicate: number;
  warehouseStockIn: number;
  ignored: number;
}

export function summarizeWaybillRowFilters(rows: WaybillImportRow[]): WaybillRowFilterCounts {
  const counts: WaybillRowFilterCounts = {
    all: rows.length,
    matched: 0,
    tracked: 0,
    noTracking: 0,
    unresolved: 0,
    manual: 0,
    invalid: 0,
    duplicate: 0,
    warehouseStockIn: 0,
    ignored: 0,
  };

  rows.forEach((row) => {
    if (isWarehouseStockInImportRow(row)) {
      counts.warehouseStockIn += 1;
      return;
    }
    if (row.match_status === 'ignored') {
      counts.ignored += 1;
      return;
    }
    if (row.match_status === 'matched') {
      counts.matched += 1;
      if (row.no_tracking_required) counts.noTracking += 1;
      else counts.tracked += 1;
      return;
    }
    if (unresolvedStatuses.has(row.match_status)) {
      counts.unresolved += 1;
      if (row.match_status === 'unmatched' || row.match_status === 'ambiguous') counts.manual += 1;
      if (row.match_status === 'invalid') counts.invalid += 1;
      if (row.match_status === 'duplicate') counts.duplicate += 1;
    }
  });

  return counts;
}

export function isSupportedWaybillFilename(filename: string): boolean {
  return /\.(xlsx|xlsm)$/i.test(filename.trim());
}

export function isRecoverableWaybillDraft(
  draft: Pick<WaybillImportBatch, 'id' | 'filename'> | null,
  filename: string,
  previousBatchId: number | undefined,
  forceReparse: boolean,
): draft is Pick<WaybillImportBatch, 'id' | 'filename'> {
  return Boolean(
    draft
    && draft.filename === filename
    && (!forceReparse || draft.id !== previousBatchId),
  );
}

export function filterWaybillRows(rows: WaybillImportRow[], filter: RowFilter): WaybillImportRow[] {
  const filtered = rows.filter((row) => {
    if (filter === 'gap') return false;
    if (filter === 'all') return true;
    if (filter === 'unresolved') return unresolvedStatuses.has(row.match_status);
    if (filter === 'matched') return row.match_status === 'matched';
    if (filter === 'tracked') return row.match_status === 'matched' && !row.no_tracking_required;
    if (filter === 'manual') return row.match_status === 'unmatched' || row.match_status === 'ambiguous';
    if (filter === 'invalid') return row.match_status === 'invalid';
    if (filter === 'duplicate') return row.match_status === 'duplicate';
    if (filter === 'no_tracking') return row.match_status === 'matched' && row.no_tracking_required;
    if (filter === 'warehouse_stock_in') return isWarehouseStockInImportRow(row);
    return row.match_status === 'ignored' && !isWarehouseStockInImportRow(row);
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

export function recommendedMonthEndGapIds(
  gaps: Array<Pick<ShippingGapDetail, 'shipping_detail_id' | 'suggested_month_end' | 'remaining_quantity'>>,
): number[] {
  return gaps
    .filter((gap) => gap.suggested_month_end && gap.remaining_quantity > 0)
    .map((gap) => gap.shipping_detail_id);
}

export function remainingPlanGapQuantity(
  gaps: Array<Pick<ShippingGapDetail, 'remaining_quantity'>>,
): number {
  return gaps.reduce((sum, gap) => sum + Math.max(gap.remaining_quantity, 0), 0);
}
