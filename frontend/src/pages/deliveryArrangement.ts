import type { DeliveryArrangement, DeliveryOptions } from '../api/orderSources';

export function initialDelivery(options?: DeliveryOptions | null): DeliveryArrangement | undefined {
  return options?.issues.length ? { scope: options.full_period_available ? 'full_period' : 'from_issue', postal_confirmed: false } : undefined;
}

export function deliveryComplete(plan?: DeliveryArrangement): boolean {
  return !plan || (plan.postal_confirmed && (plan.scope === 'full_period' || !!plan.effective_from_issue));
}
