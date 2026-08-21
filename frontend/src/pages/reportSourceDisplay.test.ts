import { describe, expect, it } from 'vitest';
import type { ReportSourceDocument, ReportSourceItem } from '../api/reportSources';
import {
  compareReportEntriesToSources,
  sourceAdjustmentDescription,
  sourceCardStatus,
  sourceCorrectionSuggestions,
  sourceIssueLinkLabel,
  sourceItemQuantityLabel,
  sourcePurposeLabel,
  sourceQuantityLabel,
  sourceTargetTreatment,
} from './reportSourceDisplay';

const item = (overrides: Partial<ReportSourceItem> = {}): ReportSourceItem => ({
  id: 1, document_id: 1, issue_number: 2650, item_kind: 'base', category: 'postal',
  sub_category: '本市', source_label: '本市', source_quantity: 1214, applied_quantity: 1214,
  source_status: 'confirmed', source_action: 'base', applied_phase: 'pre_confirmation',
  print_delta: 1214, effect_status: 'active', supersedes_item_id: null, adjustment_kind: null,
  settlement_delta: 0, shipping_delta: 0, shipped_quantity: 0, tracking_no: null,
  shipped_at: null, notes: null, confirmed_at: null, created_at: '2026-05-04T00:00:00',
  ...overrides,
});

const document = (items: ReportSourceItem[], overrides: Partial<ReportSourceDocument> = {}): ReportSourceDocument => ({
  id: 1, channel: 'postal', document_type: 'weekly', original_filename: 'source.pdf',
  display_name: '20260504_北京邮发_原始报数.pdf', mime_type: 'application/pdf', size: 100,
  sha256: 'a'.repeat(64), source_date: '2026-05-04', upload_issue_number: 2650,
  file_available: true, extraction_status: 'confirmed', extraction_json: null, uploaded_by: 'admin',
  created_at: '2026-05-04T00:00:00', updated_at: '2026-05-04T00:00:00', items,
  ...overrides,
});

describe('report source card display', () => {
  it('uses one card status model for pending, channel pending, replaced and missing files', () => {
    const unresolved = document([], { extraction_status: 'pending_review' });
    const ocrPendingItem = item({ source_status: 'pending_review' });
    const channelPendingItem = item({ source_status: 'channel_pending' });
    const replacedItem = item({ effect_status: 'replaced' });
    const missingFile = document([item()], { file_available: false });

    expect(sourceCardStatus(unresolved, []).label).toBe('待关联刊期');
    expect(sourceCardStatus(document([ocrPendingItem]), [ocrPendingItem]).label).toBe('OCR待核对');
    expect(sourceCardStatus(
      document([channelPendingItem], { extraction_status: 'reviewed' }),
      [channelPendingItem],
    ).label).toBe('渠道待确认');
    expect(sourceCardStatus(document([replacedItem]), [replacedItem]).label).toBe('已替换');
    expect(sourceCardStatus(missingFile, missingFile.items).label).toBe('文件异常');
  });

  it('describes archive evidence and multi-issue files without counting rows as issues', () => {
    const rows = [
      item({ item_kind: 'adjustment', source_action: 'archive_only', adjustment_kind: 'archive_only' }),
      item({ id: 2, sub_category: '外埠', source_quantity: 5585, item_kind: 'adjustment', source_action: 'archive_only', adjustment_kind: 'archive_only' }),
      item({ id: 3, issue_number: 2651, source_quantity: 366, item_kind: 'adjustment', source_action: 'archive_only', adjustment_kind: 'archive_only' }),
    ];
    const evidence = document(rows, { document_type: 'adjustment' });
    expect(sourcePurposeLabel(evidence, rows.slice(0, 2))).toBe('仅归档');
    expect(sourceQuantityLabel(rows.slice(0, 2))).toBe('凭证记录 6,799 份');
    expect(sourceIssueLinkLabel(evidence, 2650)).toBe('共关联 2 期（第2650期、第2651期）');
  });

  it('distinguishes confirmed contribution from the raw recognized quantity', () => {
    const rows = [
      item({ source_quantity: 1214, print_delta: 1214 }),
      item({ id: 2, source_quantity: 5378, print_delta: 5398 }),
    ];
    expect(sourceQuantityLabel(rows)).toBe('确认计入 6,612 份（原始识别 6,592 份）');
    expect(sourceQuantityLabel([item()])).toBe('确认计入 1,214 份');
    expect(sourceQuantityLabel([item({ source_status: 'pending_review' })])).toBe('原始识别 1,214 份');
  });

  it('shows per-category confirmed quantities and keeps pending values explicit', () => {
    expect(sourceItemQuantityLabel(item({
      source_label: '本市（含损失分摊10份）', source_quantity: 1202, print_delta: 1212,
    }))).toBe('1,212 份');
    expect(sourceItemQuantityLabel(item({
      item_kind: 'adjustment', source_quantity: 1214, print_delta: 0,
    }))).toBe('1,214 份');
    expect(sourceItemQuantityLabel(item({ source_quantity: null }))).toBe('数量待核对');
  });

  it.each([
    ['base', '原始报数'],
    ['prepress_addition', '印前追加'],
    ['archive_only', '仅归档'],
    ['postpress_addition', '追加订数'],
    ['damage_reshipment', '补损重发'],
    ['reduction', '冲减'],
  ] as const)('labels %s evidence consistently', (sourceAction, label) => {
    const row = item({ source_action: sourceAction });
    expect(sourcePurposeLabel(document([row]), [row])).toBe(label);
  });

  it('shows incomplete quantities and adjustment effects without inventing totals', () => {
    expect(sourceQuantityLabel([item({ source_quantity: null })])).toBeNull();
    expect(sourceAdjustmentDescription(item({
      item_kind: 'adjustment', adjustment_kind: 'billable_addition',
      source_action: 'postpress_addition', settlement_delta: 4,
      shipping_delta: 4, shipped_quantity: 1,
    }))).toBe('结算 +4 · 应发 4 · 已发 1 · 待发 3');
    expect(sourceAdjustmentDescription(item({
      item_kind: 'adjustment', adjustment_kind: 'archive_only', source_action: 'archive_only',
    }))).toBe('仅归档 · 不改变印数、结算或补发');
  });

  it('detects source mismatches per item even when the channel total still matches', () => {
    const rows = [
      item({ source_quantity: 1214, print_delta: 1214, sub_category: '本市' }),
      item({ id: 2, source_quantity: 5702, print_delta: 5702, sub_category: '外埠' }),
    ];
    const result = compareReportEntriesToSources(
      [document(rows)],
      2650,
      [
        { category: 'postal', sub_category: '本市', value: 1215 },
        { category: 'postal', sub_category: '外埠', value: 5701 },
      ],
    );

    expect(result.channels.postal.difference).toBe(0);
    expect(result.mismatches).toEqual([
      { category: 'postal', subCategory: '本市', sourceValue: 1214, reportValue: 1215, difference: -1 },
      { category: 'postal', subCategory: '外埠', sourceValue: 5702, reportValue: 5701, difference: 1 },
    ]);
  });

  it('explains how mixed target issue states will be handled', () => {
    const suggestion = {
      issue_number: 2649,
      source_period: '2026-04#4',
      item_kind: 'base' as const,
      category: 'chengdu' as const,
      sub_category: '成都杂志铺',
      source_label: '2026年4月第4期',
      source_quantity: 366,
      applied_quantity: 366,
      source_status: 'confirmed' as const,
      adjustment_kind: null,
      source_action: 'base' as const,
      supersedes_item_id: null,
      confidence: 0.99,
      notes: null,
      target_issue_status: 'confirmed' as const,
    };

    expect(sourceTargetTreatment(suggestion)).toEqual({
      label: '已确认期 → 仅归档凭证',
      archiveOnly: true,
    });
  });

  it('builds a manual correction from every active editable contribution', () => {
    const editableBase = item({ target_issue_status: 'draft' });
    const editableAddition = item({
      id: 2,
      issue_number: 2651,
      source_action: 'prepress_addition',
      target_issue_status: 'scheduled',
    });
    const locked = item({ id: 3, issue_number: 2652, target_issue_status: 'confirmed' });
    const replaced = item({ id: 4, issue_number: 2653, effect_status: 'replaced', target_issue_status: 'draft' });

    expect(sourceCorrectionSuggestions(document([
      editableBase,
      editableAddition,
      locked,
      replaced,
    ]))).toEqual([
      expect.objectContaining({
        issue_number: 2650,
        source_action: 'base',
        supersedes_item_id: editableBase.id,
        source_status: 'confirmed',
      }),
      expect.objectContaining({
        issue_number: 2651,
        source_action: 'prepress_addition',
        supersedes_item_id: editableAddition.id,
        source_status: 'confirmed',
      }),
    ]);
  });
});
