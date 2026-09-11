import { describe, expect, it } from 'vitest';
import { formatImportValue, importReason, importStatusLabel, snapshotChanges, snapshotFields } from './orderImportDisplay';
import type { ImportPreviewRow } from '../api/orderImport';

describe('导入详情的业务文案', () => {
  it('去掉序列化引号，正确展示金额、日期、换行和空值', () => {
    expect(formatImportValue('paid_amount', '150.00')).toBe('¥150.00');
    expect(formatImportValue('payment_time', '2026-09-01T09:30:00')).toBe('2026-09-01 09:30:00');
    expect(formatImportValue('invoice', '合成公司\t\n合成税号')).toBe('合成公司 \n合成税号');
    expect(formatImportValue('recipient_phone', '0012345')).toBe('0012345');
    expect(formatImportValue('paid_amount', 0)).toBe('¥0.00');
    expect(formatImportValue('notes', null)).toBe('未填写');
    expect(formatImportValue('is_shipping', false)).toBe('否');
  });

  it('状态全部中文化，未知状态不冒充已付款', () => {
    expect(importStatusLabel('卖家已退款', 'refunded', false)).toBe('已退款');
    expect(importStatusLabel('特殊平台状态', 'paid', true)).toBe('状态待核对');
    expect(importStatusLabel('', 'future_status', false)).toBe('状态待核对');
  });

  it('识别原因使用原商品名称，去掉程序字符串转义并给出处理方式', () => {
    const row = { reason: "商品库无匹配：'合成商品\\n全年'", unresolved_product: '合成商品\n全年' } as ImportPreviewRow;
    expect(importReason(row)).toBe('未在商品库中找到「合成商品\n全年」。请关联已有商品或新增商品，再重新预览。');
  });

  it('商品与原表补充字段拆成中文条目，保留未知字段的内容', () => {
    const fields = snapshotFields({
      product_lines: [{ name: '合成运费', quantity: 40, unit_price: '3.00', is_shipping: true }],
      raw_cells: { sku: '全年邮局', merchant_note: '工作日收件', future_key: '补充内容' },
    });
    expect(fields.map(field => field.label)).toEqual(expect.arrayContaining([
      '商品 1 · 商品名称', '商品 1 · 数量', '商品 1 · 单价', '原表 · 商品规格', '原表 · 商家备注',
    ]));
    expect(fields.find(field => field.value === '补充内容')?.label).not.toContain('future_key');
  });
});

describe('来源变化核对', () => {
  it('展示备注清空、原表专属字段及商品数量变化，忽略文件位置', () => {
    const before = { filename: 'old.xlsx', source_row: 2, notes: '工作日收件', product_lines: [{ name: '合成商品', quantity: 1 }], raw_cells: { sku: '半年', tracking: '合成运单' } };
    const after = { filename: 'new.xlsx', source_row: 22, notes: '', product_lines: [{ name: '合成商品', quantity: 2 }], raw_cells: { sku: '全年', tracking: '合成运单' } };
    const changes = snapshotChanges(before, after);
    expect(changes).toHaveLength(3);
    expect(changes.find(change => change.label === '订单备注')).toMatchObject({ before: '工作日收件', after: '已清空', kind: '清空' });
    expect(changes.find(change => change.label === '原表 · 商品规格')).toMatchObject({ before: '半年', after: '全年' });
    expect(changes.find(change => change.label === '商品 1 · 数量')).toMatchObject({ before: '1', after: '2' });
  });

  it('新增、删除、类型及格式变化均不静默丢失', () => {
    const changes = snapshotChanges({ paid_amount: '150.0', raw_cells: { merchant_note: '旧备注' }, notes: null }, { paid_amount: '150.00', raw_cells: { tracking: '新运单' }, notes: '' });
    expect(changes.find(change => change.label === '原付款金额')?.kind).toBe('格式变化');
    expect(changes.find(change => change.label === '原表 · 商家备注')).toMatchObject({ kind: '移除', after: '本次未提供此项' });
    expect(changes.find(change => change.label === '原表 · 物流单号')).toMatchObject({ kind: '新增', before: '上次未提供此项' });
    expect(changes.find(change => change.label === '订单备注')?.kind).toBe('格式变化');
    expect(snapshotChanges({ raw_cells: { a: '1', b: '2' } }, { raw_cells: { b: '2', a: '1' } })).toEqual([]);
  });
});
