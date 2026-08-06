import type { ShippingDetail } from '../api/shippingDetails';

export function getPackageCopy(record: ShippingDetail): { title: string; detail: string | null } {
  if (record.shipping_requirement === 'no_tracking_required' || record.fulfillment_status === 'no_tracking_required') {
    return { title: '无需运单', detail: null };
  }
  if (record.package_count > 0) {
    const pending = Math.max(record.quantity - record.handled_quantity, 0);
    return {
      title: `${record.package_count.toLocaleString()} 个包裹`,
      detail: pending > 0 ? `还差 ${pending.toLocaleString()} 份` : null,
    };
  }
  return { title: '尚未录入运单', detail: null };
}
