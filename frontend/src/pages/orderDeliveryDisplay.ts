import type { FulfillmentAllocationOut, FulfillmentTargetOut, OrderItemOut } from '../api/orders';
import { deliveryMethodLabel } from './orderUtils';

export function allocationDisplayTargets(item: OrderItemOut, allocation?: FulfillmentAllocationOut): FulfillmentTargetOut[] {
  return (allocation?.targets ?? []).filter(target => !item.delivery_segments?.length || !target.replaced_by_target_id
    || item.delivery_segments.some(segment => segment.target_id === target.id));
}

export function targetDeliveryLabel(item: OrderItemOut, target: FulfillmentTargetOut): string {
  const channel = target.resolved_shipping_channel ?? (target.source_delivery_managed ? target.shipping_channel : null);
  return channel ? channel === 'post_office' ? '邮局投递' : channel === 'zto_outsource' ? '中通快递' : '其他投递'
    : deliveryMethodLabel(item.delivery_method);
}

export function itemDeliveryLabel(item: OrderItemOut): string {
  const segments = item.delivery_segments ?? [];
  if (!segments.length) return deliveryMethodLabel(item.delivery_method);
  const channels = [...new Set(segments.map(segment => segment.shipping_channel))];
  if (channels.length === 1) return channels[0] === 'post_office' ? '邮局投递' : channels[0] === 'zto_outsource'
    ? item.fulfillment_type === 'subscription' || item.fulfillment_type === 'extension' ? '中通快递 · 全订期' : '中通快递' : '其他投递';
  const ordered = [...segments].sort((a, b) => a.from_issue - b.from_issue);
  const overlap = ordered.some((a, index) => ordered.slice(index + 1).some(b =>
    a.shipping_channel !== b.shipping_channel && a.from_issue <= b.until_issue && b.from_issue <= a.until_issue));
  if (overlap) return '多种投递方式（分收件人履约）';
  const label = (channel: string) => channel === 'post_office' ? '邮局' : channel === 'zto_outsource' ? '中通' : '其他';
  const changes = ordered.filter((segment, index) => !index || segment.shipping_channel !== ordered[index - 1].shipping_channel);
  const last = changes[changes.length - 1];
  return `${changes.map(segment => label(segment.shipping_channel)).join(' → ')}（第 ${last.from_issue} 期起）`;
}
