import { describe, expect, it } from 'vitest';
import type { ReportSourceDocument, ReportSourceItem } from '../api/reportSources';
import {
  sourceAdjustmentDescription,
  sourceCardStatus,
  sourceIssueLinkLabel,
  sourcePurposeLabel,
  sourceQuantityLabel,
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
});
