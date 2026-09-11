import type { ImportPreviewRow } from '../api/orderImport';
import type { OrderCommercialStatus } from '../api/orders';
import { commercialStatusLabel } from './orderUtils';

const STATUS_VALUES = new Set(['pending_payment', 'paid', 'shipped', 'refunded', 'partial_refund', 'cancelled']);
const FIELD_LABELS: Record<string, string> = {
  platform: '订单平台', store: '店铺', external_order_no: '来源单号',
  status_raw: '平台状态', status: '平台状态', commercial_status: '识别状态',
  paid_amount: '原付款金额', original_amount: '商品原价',
  recipient_name: '收件人', recipient_phone: '联系电话', recipient_address: '收件地址',
  recipient_postal_code: '邮政编码', notes: '订单备注', order_date: '下单日期',
  order_time: '下单时间', payment_time: '支付时间', payment_method: '支付方式',
  invoice: '开票信息', product_lines: '商品', raw_cells: '原表',
  name: '商品名称', raw: '商品原文', product: '产品名称', quantity: '数量', unit_price: '单价',
  is_shipping: '是否为运费', mentions_zto: '是否提及中通', address: '收件信息原文',
  goods_payable: '应付货款', postage: '应付邮费', list_total: '商品总金额', total_qty: '商品总数量',
  sku: '商品规格', merchant_note: '商家备注', tracking: '物流单号', logistics: '物流公司', ship_time: '发货时间',
  filename: '来源文件', source_sheet: '工作表', source_row: '所在行',
};
const AMOUNT_FIELDS = new Set(['paid_amount', 'original_amount', 'unit_price', 'goods_payable', 'postage', 'list_total']);
const LOCATION_FIELDS = new Set(['filename', 'source_sheet', 'source_row']);

export function importFieldLabel(key: string, index = 0): string {
  return Object.hasOwn(FIELD_LABELS, key) ? FIELD_LABELS[key] : /[\u3400-\u9fff]/.test(key) ? key : `其他信息 ${index + 1}`;
}

export function importStatusLabel(raw: string, status: string | null, unknown: boolean): string {
  if (unknown) return '状态待核对';
  if (status && STATUS_VALUES.has(status)) return commercialStatusLabel(status as OrderCommercialStatus);
  return /[\u3400-\u9fff]/.test(raw) ? raw : '状态待核对';
}

export function formatImportValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '未填写';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'object') return Array.isArray(value) ? '无条目' : '无内容';
  const text = String(value).replace(/\r\n?/g, '\n').replace(/\t/g, ' ');
  if (AMOUNT_FIELDS.has(key) && /^-?\d+(\.\d+)?$/.test(text)) {
    // 不把电话号码、邮编或原始单号转成数字，保留前导零。
    return `¥${Number(text).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (['status_raw', 'status', 'commercial_status'].includes(key)) {
    return importStatusLabel(text, text, false);
  }
  if (key === 'payment_method') return ({ wechat: '微信', alipay: '支付宝', bank_card: '银行卡' } as Record<string, string>)[text] ?? text;
  if (['order_date', 'order_time', 'payment_time', 'ship_time'].includes(key)) return text.replace(/^(\d{4}-\d{2}-\d{2})T/, '$1 ');
  return text;
}

export interface SnapshotField {
  id: string;
  key: string;
  label: string;
  value: unknown;
}

/** 逐项展开快照；原表和未知扩展项同样可读，不输出整个对象。 */
export function snapshotFields(snapshot: Record<string, unknown>, reference: Record<string, unknown> = snapshot): SnapshotField[] {
  const fields: SnapshotField[] = [];
  function visit(value: unknown, peer: unknown, path: string[], labels: string[]): void {
    if (Array.isArray(value) && value.length) {
      value.forEach((item, i) => visit(item, Array.isArray(peer) ? peer[i] : undefined, [...path, String(i)],
        [...labels.slice(0, -1), `${labels.at(-1)} ${i + 1}`]));
    } else if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length) {
      const record = value as Record<string, unknown>;
      const other = peer && typeof peer === 'object' ? peer as Record<string, unknown> : {};
      const keys = [...new Set([...Object.keys(record), ...Object.keys(other)])].sort();
      keys.forEach((key, i) => {
        if (Object.hasOwn(record, key)) visit(record[key], other[key], [...path, key], [...labels, importFieldLabel(key, i)]);
      });
    } else {
      fields.push({ id: JSON.stringify(path), key: path.at(-1)!, label: labels.join(' · '), value });
    }
  }
  const keys = [...new Set([...Object.keys(snapshot), ...Object.keys(reference)])].sort();
  keys.forEach((key, index) => {
    if (Object.hasOwn(snapshot, key) && !LOCATION_FIELDS.has(key)) visit(snapshot[key], reference[key], [key], [importFieldLabel(key, index)]);
  });
  return fields;
}

export interface SnapshotChange {
  id: string;
  label: string;
  before: string;
  after: string;
  kind: '新增' | '移除' | '清空' | '修改' | '格式变化';
}

export function snapshotChanges(before: Record<string, unknown>, after: Record<string, unknown>): SnapshotChange[] {
  const oldFields = new Map(snapshotFields(before, after).map(field => [field.id, field]));
  const newFields = new Map(snapshotFields(after, before).map(field => [field.id, field]));
  return [...new Set([...oldFields.keys(), ...newFields.keys()])].flatMap(id => {
    const oldField = oldFields.get(id);
    const newField = newFields.get(id);
    if (oldField && newField && JSON.stringify(oldField.value) === JSON.stringify(newField.value)) return [];
    const previous = oldField ? formatImportValue(oldField.key, oldField.value) : '上次未提供此项';
    const current = newField ? formatImportValue(newField.key, newField.value) : '本次未提供此项';
    const kind = !oldField ? '新增' : !newField ? '移除' : previous === current ? '格式变化' : current === '未填写' ? '清空' : '修改';
    return [{ id, label: (newField ?? oldField)!.label, before: previous, after: kind === '清空' ? '已清空' : current, kind }];
  });
}

export function importResultCopy(row: ImportPreviewRow): { title: string; description: string } {
  const reason = importReason(row);
  switch (row.decision) {
    case 'import': return { title: '确认后新建订单', description: reason || '请核对商品、金额和订期，再返回预览确认导入。' };
    case 'retain': return {
      title: '确认后仅保存交易记录',
      description: reason.startsWith('纯运费')
        ? '这是一笔单独支付的运费。保存后可到「来源交易」关联订阅；如需改为中通投递，再单独核对确认。'
        : reason.startsWith('补充订单原件') || reason.startsWith('已有业务订单')
          ? '订单已经存在。本次补充保存原始交易记录，保留订单中已人工修改的信息。'
          : reason || '保存原始交易记录，不新增订阅或发货。',
    };
    case 'source_update': return { title: '这笔交易的信息有变化', description: '请核对下方变化。确认导入后保存新版本，上次记录仍会保留。' };
    case 'duplicate': return { title: '这笔交易已经保存', description: reason || '本次无需重复导入。' };
    case 'unresolved': return { title: '这笔交易需要先核对', description: reason || '请核对原表中的商品和日期，再重新预览。' };
    case 'skip_status': return { title: '本次不导入这笔交易', description: reason || '请按导入规则核对这笔交易。' };
  }
}

export function importReason(row: ImportPreviewRow): string {
  if (row.reason?.startsWith('商品库无匹配') && row.unresolved_product) {
    return `未在商品库中找到「${row.unresolved_product}」。请关联已有商品或新增商品，再重新预览。`;
  }
  if (row.reason === '缺少下单/支付时间') return '原表未提供有效的下单或支付日期，请补齐后重新预览。';
  return row.reason ?? '';
}
