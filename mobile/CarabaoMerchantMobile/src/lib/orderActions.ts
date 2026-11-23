// src/lib/orderActions.ts
// S4 (plan §5.2): the rules the Orders tab shares with the web merchant dashboard.
// The web copies are W/util/api/merchants.ts (cancel reasons), the backend
// app/services/order_status.py (MERCHANT_TRANSITIONS) and M/components/OrdersTab.tsx
// (the filter chips); inStep.test.ts keeps this file in step with them.
// Pure (type-only imports), for `npm test`.
import type { MerchantOrderStatus } from './api.ts';
import { ORDER_STATUS_LABELS, type OrderStatus } from './orderStatus.ts';

// Same keys and labels as MERCHANT_CANCEL_REASONS in W/util/api/merchants.ts. The
// backend keeps the same keys, with the buyer-facing wording (merchant_cancel_text).
export const MERCHANT_CANCEL_REASONS = [
  { key: 'out_of_stock', label: 'Out of stock' },
  { key: 'quality', label: "Produce didn't meet quality standards" },
  { key: 'cannot_deliver', label: "Can't deliver to this address or date" },
  { key: 'buyer_request', label: 'The buyer asked to cancel' },
  { key: 'other', label: 'Other' },
] as const;
export type MerchantCancelReason = (typeof MERCHANT_CANCEL_REASONS)[number]['key'];
// CancelOrderForm.tsx: "other" needs a message; every reason may add one up to this.
export const MERCHANT_CANCEL_NOTE_MAX = 300;

// The statuses a farm may move an order to, from each status (backend
// MERCHANT_TRANSITIONS). Only the server enforces it; this decides the buttons.
// "delivered" is never here: the buyer confirms it, or the auto-confirm sweep does.
const MERCHANT_TRANSITIONS: Record<MerchantOrderStatus, readonly MerchantOrderStatus[]> = {
  pending: [],
  processing: ['shipped', 'cancelled'],
  shipped: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['cancelled'],
  delivered: [],
  cancelled: [],
};

/** The status changes the web lets a farm make from `status`, and no other. */
export function nextStatuses(status: string): MerchantOrderStatus[] {
  return [...(MERCHANT_TRANSITIONS[status as MerchantOrderStatus] ?? [])];
}

/**
 * Whether the web OrderCard shows its Cancel button: an order that is not closed
 * (web statuses.ts isClosed: delivered, cancelled, payment_mismatch).
 */
export function canCancel(status: string): boolean {
  return nextStatuses(status).includes('cancelled');
}

// The web OrdersTab.tsx chips; no "pending", as unpaid checkouts never reach a farm.
export const ORDER_FILTERS = [
  'all',
  'processing',
  'shipped',
  'out_for_delivery',
  'delivered',
  'cancelled',
] as const;
export type OrderFilterKey = (typeof ORDER_FILTERS)[number];

/** A chip's text: "All", else the web order status label ("Preparing", ...). */
export function orderFilterLabel(filter: OrderFilterKey): string {
  return filter === 'all' ? 'All' : ORDER_STATUS_LABELS[filter as OrderStatus];
}

/** The orders a chip shows (web: all, or `orderedItems.filter((o) => o.status === chip)`). */
export function orderFilter<T extends { status: string }>(
  orders: readonly T[],
  filter: OrderFilterKey,
): T[] {
  return filter === 'all' ? [...orders] : orders.filter((o) => o.status === filter);
}

/** How many orders each chip shows, for the chip counts. */
export function orderCounts(
  orders: readonly { status: string }[],
): Record<OrderFilterKey, number> {
  const counts: Record<OrderFilterKey, number> = {
    all: orders.length,
    processing: 0,
    shipped: 0,
    out_for_delivery: 0,
    delivered: 0,
    cancelled: 0,
  };
  for (const order of orders) {
    const key = order.status as OrderFilterKey;
    // An unknown status (say payment_mismatch) is only in "all".
    if (key !== 'all' && key in counts) counts[key] += 1;
  }
  return counts;
}
