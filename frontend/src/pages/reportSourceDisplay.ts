import type {
  ReportSourceAction,
  ReportSourceDocument,
  ReportSourceItem,
  ReportSourceSuggestion,
} from '../api/reportSources';

export type SourceCardTone = 'neutral' | 'success' | 'warning' | 'danger';
export type SourceOperation = 'initial' | 'addition' | 'replacement' | 'correction' | 'postpress' | 'review';

export interface SourceEntryComparison {
  category: string;
  subCategory: string;
  sourceValue: number;
  reportValue: number | null;
  difference: number;
}

export interface SourceChannelComparison {
  sourceTotal: number;
  reportTotal: number;
  difference: number;
  mismatches: SourceEntryComparison[];
}

const purposeLabels: Record<string, string> = {
  base: '原始报数',
  prepress_addition: '印前追加',
  archive_only: '仅归档',
  postpress_addition: '追加订数',
  damage_reshipment: '补损重发',
  reduction: '冲减',
};

export function sourceActionForSubmission(
  operation: SourceOperation,
  suggestion: ReportSourceSuggestion,
  replacementAction?: ReportSourceAction,
): ReportSourceAction {
  if (operation === 'review') return suggestion.source_action;
  if (suggestion.item_kind === 'adjustment') return 'postpress_addition';
  if (operation === 'addition') return 'prepress_addition';
  if (operation === 'replacement' || operation === 'correction') {
    return replacementAction ?? 'base';
  }
  return 'base';
}

export function sourceItemsForIssue(document: ReportSourceDocument, issueNumber: number) {
  return document.items.filter(item => item.issue_number === issueNumber);
}

export function sourceCorrectionSuggestions(document: ReportSourceDocument): ReportSourceSuggestion[] {
  return document.items
    .filter(item => (
      item.item_kind === 'base'
      && item.source_status === 'confirmed'
      && item.effect_status === 'active'
      && ['base', 'prepress_addition'].includes(item.source_action)
      && item.target_issue_status !== 'confirmed'
      && item.target_issue_status !== 'exported'
    ))
    .map(item => ({
      issue_number: item.issue_number,
      source_period: null,
      item_kind: item.item_kind,
      category: item.category as ReportSourceSuggestion['category'],
      sub_category: item.sub_category,
      source_label: item.source_label,
      source_quantity: item.source_quantity,
      applied_quantity: item.applied_quantity,
      source_status: 'confirmed',
      adjustment_kind: null,
      source_action: item.source_action,
      supersedes_item_id: item.id,
      confidence: null,
      notes: item.notes,
      target_issue_status: item.target_issue_status,
    }));
}

export function sourcePurposeLabel(document: ReportSourceDocument, items: ReportSourceItem[]) {
  const labels = [...new Set(items.map(item => purposeLabels[item.source_action]).filter(Boolean))];
  if (labels.length > 0) return labels.join(' / ');
  if (document.document_type === 'adjustment') return '确认后凭证';
  return document.document_type === 'monthly' ? '月度报数' : '原始报数';
}

export function sourceCardStatus(
  document: ReportSourceDocument,
  currentItems: ReportSourceItem[],
): { label: string; tone: SourceCardTone } {
  if (!document.file_available) return { label: '文件异常', tone: 'danger' };
  if (document.extraction_status === 'pending_review'
    || currentItems.some(item => item.source_status === 'pending_review')) {
    return { label: currentItems.length === 0 ? '待关联刊期' : 'OCR待核对', tone: 'warning' };
  }
  if (currentItems.some(item => item.source_status === 'channel_pending')) {
    return { label: '渠道待确认', tone: 'warning' };
  }
  if (currentItems.length > 0 && currentItems.every(item => item.effect_status === 'replaced')) {
    return { label: '已替换', tone: 'neutral' };
  }
  if (currentItems.length === 0) return { label: '待关联刊期', tone: 'warning' };
  return { label: '来源已人工确认', tone: 'success' };
}

export function sourceQuantityLabel(items: ReportSourceItem[]) {
  if (items.length === 0 || items.some(item => item.source_quantity == null)) return null;
  const sourceTotal = items.reduce((sum, item) => sum + Math.abs(item.source_quantity ?? 0), 0);
  const allBase = items.every(item => item.item_kind === 'base');
  const allConfirmed = items.every(item => item.source_status === 'confirmed');
  if (!allBase) return `凭证记录 ${sourceTotal.toLocaleString('zh-CN')} 份`;
  if (!allConfirmed) return `原始识别 ${sourceTotal.toLocaleString('zh-CN')} 份`;

  const confirmedTotal = items.reduce((sum, item) => sum + item.print_delta, 0);
  const confirmedLabel = `确认计入 ${confirmedTotal.toLocaleString('zh-CN')} 份`;
  if (confirmedTotal === sourceTotal) return confirmedLabel;
  return `${confirmedLabel}（原始识别 ${sourceTotal.toLocaleString('zh-CN')} 份）`;
}

export function sourceItemQuantityLabel(item: ReportSourceItem) {
  if (item.source_quantity == null) return '数量待核对';
  const quantity = item.item_kind === 'base' && item.source_status === 'confirmed'
    ? item.print_delta
    : item.source_quantity;
  return `${Math.abs(quantity).toLocaleString('zh-CN')} 份`;
}

export function sourceIssueLinkLabel(document: ReportSourceDocument, currentIssueNumber: number) {
  const issueNumbers = [...new Set(document.items.map(item => item.issue_number))].sort((a, b) => a - b);
  if (issueNumbers.length === 0) {
    return document.upload_issue_number === currentIssueNumber ? '上传于本期 · 待关联刊期' : '待关联刊期';
  }
  if (issueNumbers.length === 1) return `关联第 ${issueNumbers[0]} 期`;
  return `共关联 ${issueNumbers.length} 期（${issueNumbers.map(value => `第${value}期`).join('、')}）`;
}

export function sourceAdjustmentDescription(item: ReportSourceItem) {
  if (item.adjustment_kind === 'archive_only') return '仅归档 · 不改变印数、结算或补发';
  const settlement = `结算 ${item.settlement_delta >= 0 ? '+' : ''}${item.settlement_delta}`;
  const shipping = `应发 ${item.shipping_delta} · 已发 ${item.shipped_quantity}`;
  const pending = item.shipping_delta > 0
    ? ` · 待发 ${Math.max(0, item.shipping_delta - item.shipped_quantity)}`
    : '';
  return `${settlement} · ${shipping}${pending}`;
}

export function compareReportEntriesToSources(
  documents: ReportSourceDocument[],
  issueNumber: number,
  entries: { category: string; sub_category: string; value: number }[],
): { channels: Record<string, SourceChannelComparison>; mismatches: SourceEntryComparison[] } {
  const sourceTotals = new Map<string, { category: string; subCategory: string; value: number }>();
  for (const document of documents) {
    for (const item of document.items) {
      if (item.issue_number !== issueNumber
        || item.source_status !== 'confirmed'
        || item.effect_status !== 'active'
        || !['base', 'prepress_addition'].includes(item.source_action)) continue;
      const key = `${item.category}\u0000${item.sub_category}`;
      const current = sourceTotals.get(key);
      sourceTotals.set(key, {
        category: item.category,
        subCategory: item.sub_category,
        value: (current?.value ?? 0) + item.print_delta,
      });
    }
  }
  const reportValues = new Map<string, number>(entries.map(entry => (
    [`${entry.category}\u0000${entry.sub_category}`, entry.value] as const
  )));
  const mismatches: SourceEntryComparison[] = [];
  const channels: Record<string, SourceChannelComparison> = {};
  for (const [key, source] of sourceTotals) {
    const reportValue = reportValues.get(key) ?? null;
    const difference = source.value - (reportValue ?? 0);
    const channel = channels[source.category] ?? {
      sourceTotal: 0,
      reportTotal: 0,
      difference: 0,
      mismatches: [],
    };
    channel.sourceTotal += source.value;
    channel.reportTotal += reportValue ?? 0;
    channel.difference = channel.sourceTotal - channel.reportTotal;
    if (reportValue !== source.value) {
      const mismatch = {
        category: source.category,
        subCategory: source.subCategory,
        sourceValue: source.value,
        reportValue,
        difference,
      };
      channel.mismatches.push(mismatch);
      mismatches.push(mismatch);
    }
    channels[source.category] = channel;
  }
  return { channels, mismatches };
}

export function sourceTargetTreatment(suggestion: ReportSourceSuggestion) {
  if (suggestion.item_kind === 'adjustment') {
    return { label: '已确认期 → 按所选凭证处理', archiveOnly: false };
  }
  if (suggestion.target_issue_status === 'confirmed' || suggestion.target_issue_status === 'exported') {
    return { label: '已确认期 → 仅归档凭证', archiveOnly: true };
  }
  if (suggestion.target_issue_status === 'scheduled') {
    return { label: '尚未创建 → 创建后写入印数', archiveOnly: false };
  }
  if (suggestion.target_issue_status === 'draft') {
    return { label: '草稿期 → 写入印数', archiveOnly: false };
  }
  return { label: '提交时复核刊期状态', archiveOnly: false };
}
