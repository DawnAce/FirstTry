import type { ShippingDeferral } from '../api/shippingWaybills';

const datePart = (value: string | null | undefined): string | null => value?.slice(0, 10) ?? null;

export interface ShippingDeferralSummary {
  recordCount: number;
  quantity: number;
  twiceMonthlyCount: number;
  monthEndCount: number;
  overdueCount: number;
  legacyCount: number;
}

export function summarizeShippingDeferrals(
  items: ShippingDeferral[],
  today = new Date().toISOString().slice(0, 10),
): ShippingDeferralSummary {
  return {
    recordCount: items.length,
    quantity: items.reduce((sum, item) => sum + Math.max(item.quantity, 0), 0),
    twiceMonthlyCount: items.filter((item) => item.deferral_type === 'twice_monthly_consolidation').length,
    monthEndCount: items.filter((item) => item.deferral_type === 'month_end_consolidation').length,
    overdueCount: items.filter((item) => {
      const targetDate = datePart(item.target_publish_date);
      return targetDate != null && targetDate < today;
    }).length,
    legacyCount: items.filter((item) => item.target_issue_number == null && !item.target_publish_date).length,
  };
}

export function deferralsForTargetIssue(
  items: ShippingDeferral[],
  issueNumber: number | null | undefined,
  publishDate: string | null | undefined,
): ShippingDeferral[] {
  const targetDate = datePart(publishDate);
  return items.filter((item) => {
    if (item.target_issue_number != null) return item.target_issue_number === issueNumber;
    return Boolean(item.target_publish_date && targetDate && datePart(item.target_publish_date) === targetDate);
  });
}

export function isOverdueDeferral(item: ShippingDeferral, today: string): boolean {
  const targetDate = datePart(item.target_publish_date);
  return targetDate != null && targetDate < today;
}

export function isLegacyDeferral(item: ShippingDeferral): boolean {
  return item.target_issue_number == null && !item.target_publish_date;
}
