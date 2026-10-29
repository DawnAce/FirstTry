import { describe, expect, it } from 'vitest';
import type { FulfillmentAllocationOut, FulfillmentTargetOut, OrderItemOut } from '../api/orders';
import { itemDeliveryLabel, targetDeliveryLabel, allocationDisplayTargets } from './orderDeliveryDisplay';
import { deliveryComplete, initialDelivery } from './deliveryArrangement';

const item = { delivery_method: 'post_office', fulfillment_type: 'subscription' } as OrderItemOut;
const postal = { target_id: 1, shipping_channel: 'post_office', from_issue: 9001, until_issue: 9002, start_date: '2099-01-01', end_date: '2099-01-08' } as const;
const zto = { target_id: 2, shipping_channel: 'zto_outsource', from_issue: 9003, until_issue: 9050, start_date: '2099-01-15', end_date: '2099-12-31' } as const;

describe('按实际履约段展示', () => {
  it('全订期中通不再显示原邮局商品的投递方式', () => {
    expect(itemDeliveryLabel({ ...item, delivery_segments: [zto] })).toBe('中通快递 · 全订期');
  });
  it('中途转投同时展示前后方式及准确分界', () => {
    expect(itemDeliveryLabel({ ...item, delivery_segments: [zto, postal] })).toBe('邮局 → 中通（第 9003 期起）');
  });
  it('不同收件人同时分渠道不冒充中途转投', () => {
    expect(itemDeliveryLabel({ ...item, delivery_segments: [postal, { ...zto, from_issue: 9001 }] })).toBe('多种投递方式（分收件人履约）');
    expect(itemDeliveryLabel({ ...item, delivery_segments: [{ ...postal, until_issue: 9005 }, zto] })).toBe('多种投递方式（分收件人履约）');
  });
  it('恢复邮局保留完整转换顺序', () => {
    expect(itemDeliveryLabel({ ...item, delivery_segments: [postal, { ...zto, until_issue: 9010 },
      { ...postal, target_id: 3, from_issue: 9011, until_issue: 9050 }] })).toBe('邮局 → 中通 → 邮局（第 9011 期起）');
  });
  it('全订期隐藏空邮局前段，中途仍保留有覆盖期的邮局目标', () => {
    const allocation = { targets: [{ id: 1, replaced_by_target_id: 2 }, { id: 2 }] } as FulfillmentAllocationOut;
    expect(allocationDisplayTargets({ ...item, delivery_segments: [zto] }, allocation).map(row => row.id)).toEqual([2]);
    expect(allocationDisplayTargets({ ...item, delivery_segments: [postal, zto] }, allocation).map(row => row.id)).toEqual([1, 2]);
  });
  it('以服务端实际渠道为准，旧接口仍兼容原邮局口径', () => {
    const target = { shipping_channel: 'zto_outsource', source_delivery_managed: false } as FulfillmentTargetOut;
    expect(targetDeliveryLabel(item, target)).toBe('邮局投递');
    expect(targetDeliveryLabel(item, { ...target, resolved_shipping_channel: 'zto_outsource' })).toBe('中通快递');
  });
});

describe('运费关联的投递范围', () => {
  const options = { full_period_issue: 9001, full_period_available: true, issues: [{ issue_number: 9001, publish_date: '2099-01-01' }] };
  it('未开始可选全订期，已开始选择中途，缺分界必须在本步骤补齐', () => {
    expect(initialDelivery(options)?.scope).toBe('full_period');
    expect(initialDelivery({ ...options, full_period_available: false })?.scope).toBe('from_issue');
    expect(deliveryComplete({ scope: 'from_issue', postal_confirmed: true })).toBe(false);
    expect(deliveryComplete({ scope: 'from_issue', postal_confirmed: true, effective_from_issue: 9001 })).toBe(true);
    expect(deliveryComplete({ scope: 'full_period', postal_confirmed: false })).toBe(false);
  });
});
