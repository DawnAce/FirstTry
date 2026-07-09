import { describe, expect, it } from 'vitest';
import {
  billingTypeLabel,
  canConfirmOrder,
  canDeleteOrder,
  canEditOrder,
  canVoidOrder,
  deliveryMethodLabel,
  driftColor,
  driftLabel,
  entryMethodLabel,
  eventTypeLabel,
  formatCoverage,
  formatCurrency,
  fulfillmentTypeLabel,
  orderItemStatusLabel,
  paymentMethodLabel,
  publicationLabel,
  statusBadgeColor,
  statusLabel,
  subscriptionTermLabel,
  targetStatusColor,
  targetStatusLabel,
} from './orderUtils';

describe('entryMethodLabel', () => {
  it('maps the converged entry-method enums', () => {
    expect(entryMethodLabel('manual')).toBe('手工录入');
    expect(entryMethodLabel('excel_import')).toBe('Excel 导入');
    expect(entryMethodLabel('api_sync')).toBe('API 同步');
  });
  it('returns raw value for unknown', () => {
    expect(entryMethodLabel('weird' as unknown as 'manual')).toBe('weird');
  });
});

describe('paymentMethodLabel', () => {
  it('maps known enums', () => {
    expect(paymentMethodLabel('wechat')).toBe('微信');
    expect(paymentMethodLabel('alipay')).toBe('支付宝');
    expect(paymentMethodLabel('bank_card')).toBe('银行卡');
    expect(paymentMethodLabel('corporate_transfer')).toBe('对公转账');
    expect(paymentMethodLabel('cash')).toBe('现金');
    expect(paymentMethodLabel('offset')).toBe('冲抵');
    expect(paymentMethodLabel('other')).toBe('其他');
  });
  it('handles null/undefined', () => {
    expect(paymentMethodLabel(null)).toBe('-');
    expect(paymentMethodLabel(undefined)).toBe('-');
  });
});

describe('statusLabel', () => {
  it('maps order status', () => {
    expect(statusLabel('draft')).toBe('草稿');
    expect(statusLabel('pending_confirmation')).toBe('待确认');
    expect(statusLabel('active')).toBe('生效');
    expect(statusLabel('void')).toBe('已作废');
  });
});

describe('statusBadgeColor', () => {
  it('returns ant design Badge status names', () => {
    expect(statusBadgeColor('draft')).toBe('default');
    expect(statusBadgeColor('pending_confirmation')).toBe('processing');
    expect(statusBadgeColor('active')).toBe('success');
    expect(statusBadgeColor('void')).toBe('error');
  });
});

describe('fulfillmentTypeLabel', () => {
  it('maps fulfillment types', () => {
    expect(fulfillmentTypeLabel('subscription')).toBe('订阅');
    expect(fulfillmentTypeLabel('single_issue')).toBe('单期');
    expect(fulfillmentTypeLabel('gift')).toBe('赠阅');
    expect(fulfillmentTypeLabel('makeup')).toBe('补寄');
    expect(fulfillmentTypeLabel('extension')).toBe('续订');
    expect(fulfillmentTypeLabel('replacement')).toBe('换订');
  });
});

describe('billingTypeLabel', () => {
  it('maps billing types', () => {
    expect(billingTypeLabel('paid')).toBe('付费');
    expect(billingTypeLabel('free_gift')).toBe('免费赠阅');
    expect(billingTypeLabel('bundle_gift')).toBe('搭赠');
  });
});

describe('publicationLabel', () => {
  it('maps publications', () => {
    expect(publicationLabel('cbj')).toBe('中国经营报');
    expect(publicationLabel('business_school')).toBe('商学院');
    expect(publicationLabel('other')).toBe('其他');
  });
});

describe('orderItemStatusLabel', () => {
  it('maps item status', () => {
    expect(orderItemStatusLabel('active')).toBe('有效');
    expect(orderItemStatusLabel('cancelled')).toBe('已取消');
  });
});

describe('targetStatusLabel + targetStatusColor', () => {
  it('maps target status', () => {
    expect(targetStatusLabel('active')).toBe('有效');
    expect(targetStatusLabel('suspended')).toBe('暂停');
    expect(targetStatusLabel('replaced')).toBe('已替换');
  });
  it('returns Tag colors', () => {
    expect(targetStatusColor('active')).toBe('green');
    expect(targetStatusColor('suspended')).toBe('orange');
    expect(targetStatusColor('replaced')).toBe('default');
  });
});

describe('eventTypeLabel', () => {
  it('maps event types', () => {
    expect(eventTypeLabel('created')).toBe('创建');
    expect(eventTypeLabel('imported')).toBe('导入');
    expect(eventTypeLabel('confirmed')).toBe('确认');
    expect(eventTypeLabel('modified')).toBe('修改');
    expect(eventTypeLabel('split')).toBe('拆分');
    expect(eventTypeLabel('voided')).toBe('作废');
    expect(eventTypeLabel('allocation_updated')).toBe('分配方案更新');
    expect(eventTypeLabel('target_added')).toBe('新增履约目标');
    expect(eventTypeLabel('target_replaced')).toBe('履约目标替换');
    expect(eventTypeLabel('target_suspended')).toBe('履约目标暂停');
    expect(eventTypeLabel('item_added')).toBe('新增明细');
    expect(eventTypeLabel('item_removed')).toBe('删除明细');
    expect(eventTypeLabel('item_modified')).toBe('修改明细');
    expect(eventTypeLabel('synced_to_shipping')).toBe('同步至快递');
    expect(eventTypeLabel('shipping_sync_conflict')).toBe('快递同步冲突');
  });
});

describe('formatCoverage', () => {
  it('formats start ~ end', () => {
    expect(formatCoverage('2026-03-01', '2026-12-31')).toBe('2026-03-01 ~ 2026-12-31');
  });
  it('handles null', () => {
    expect(formatCoverage(null, null)).toBe('-');
  });
  it('handles partial null', () => {
    expect(formatCoverage('2026-03-01', null)).toBe('2026-03-01 ~ -');
    expect(formatCoverage(null, '2026-12-31')).toBe('- ~ 2026-12-31');
  });
});

describe('formatCurrency', () => {
  it('formats decimal strings with ¥ prefix and 2 decimals', () => {
    expect(formatCurrency('1234.5')).toBe('¥1,234.50');
    expect(formatCurrency('0')).toBe('¥0.00');
    expect(formatCurrency('1000000')).toBe('¥1,000,000.00');
  });
  it('accepts number inputs', () => {
    expect(formatCurrency(99.99)).toBe('¥99.99');
  });
  it('handles null/undefined', () => {
    expect(formatCurrency(null)).toBe('-');
    expect(formatCurrency(undefined)).toBe('-');
  });
  it('handles NaN-producing input', () => {
    expect(formatCurrency('not-a-number')).toBe('-');
  });
});

describe('driftLabel', () => {
  it('shows + for positive', () => {
    expect(driftLabel(2)).toBe('+2');
  });
  it('shows - for negative', () => {
    expect(driftLabel(-3)).toBe('-3');
  });
  it('shows 0 for zero', () => {
    expect(driftLabel(0)).toBe('0');
  });
  it('handles null', () => {
    expect(driftLabel(null)).toBe('-');
  });
});

describe('driftColor', () => {
  it('returns success for zero', () => {
    expect(driftColor(0)).toBe('success');
  });
  it('returns warning for positive', () => {
    expect(driftColor(2)).toBe('warning');
  });
  it('returns error for negative', () => {
    expect(driftColor(-1)).toBe('error');
  });
  it('returns default for null', () => {
    expect(driftColor(null)).toBe('default');
  });
});

describe('canEditOrder / canConfirmOrder / canVoidOrder', () => {
  it('allows edit on draft and active', () => {
    expect(canEditOrder('draft')).toBe(true);
    expect(canEditOrder('active')).toBe(true);
    expect(canEditOrder('pending_confirmation')).toBe(false);
    expect(canEditOrder('void')).toBe(false);
  });
  it('allows confirm on draft and pending_confirmation', () => {
    expect(canConfirmOrder('draft')).toBe(true);
    expect(canConfirmOrder('pending_confirmation')).toBe(true);
    expect(canConfirmOrder('active')).toBe(false);
    expect(canConfirmOrder('void')).toBe(false);
  });
  it('allows void on draft/pending/active', () => {
    expect(canVoidOrder('draft')).toBe(true);
    expect(canVoidOrder('pending_confirmation')).toBe(true);
    expect(canVoidOrder('active')).toBe(true);
    expect(canVoidOrder('void')).toBe(false);
  });
  it('allows delete only on draft/void with no shipping details', () => {
    expect(canDeleteOrder('draft', 0)).toBe(true);
    expect(canDeleteOrder('void', 0)).toBe(true);
    // active / pending must be voided first
    expect(canDeleteOrder('active', 0)).toBe(false);
    expect(canDeleteOrder('pending_confirmation', 0)).toBe(false);
    // any generated shipping detail blocks delete
    expect(canDeleteOrder('draft', 1)).toBe(false);
    expect(canDeleteOrder('void', 3)).toBe(false);
  });
});

describe('subscription pricing labels', () => {
  it('formats subscription term labels', () => {
    expect(subscriptionTermLabel('half_year')).toBe('半年');
    expect(subscriptionTermLabel('one_year')).toBe('一年');
    expect(subscriptionTermLabel('custom')).toBe('自定义');
  });

  it('formats delivery method labels', () => {
    expect(deliveryMethodLabel('post_office')).toBe('邮局投递');
    expect(deliveryMethodLabel('zto_mf')).toBe('ZTO-MF 快递');
  });
});
