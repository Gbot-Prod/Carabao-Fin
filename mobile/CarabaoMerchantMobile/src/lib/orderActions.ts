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
  { key: 'buyer_not_home', label: 'The buyer was not at the address' },
  { key: 'other', label: 'Other' },
] as const;
export type MerchantCancelReason = (typeof MERCHANT_CANCEL_REASONS)[number]['key'];

// Backend ATTEMPT_ONLY_CANCEL_REASONS: only a cancel with a failed drop-off photo uses these.
const ATTEMPT_ONLY_REASONS: readonly MerchantCancelReason[] = ['buyer_not_home'];

/**
 * The reasons the cancel sheet offers. With a failed drop-off photo (`attempt`) every reason;
 * without one, not the attempt-only reasons.
 */
export function cancelReasonsFor(attempt: boolean) {
  return MERCHANT_CANCEL_REASONS.filter((r) => attempt || !ATTEMPT_ONLY_REASONS.includes(r.key));
}
// CancelOrderForm.tsx: "other" needs a message; every reason may add one up to this.
export const MERCHANT_CANCEL_NOTE_MAX = 300;

// The statuses a farm may move an order to, from each status (backend
// MERCHANT_TRANSITIONS). Only the server enforces it; this decides the buttons.
// The moves in PHOTO_MOVES need a proof photo (ORDER_PROOF_PHOTOS_PLAN.md), so the app
// takes one and calls the photo endpoint, not the status PATCH.
const MERCHANT_TRANSITIONS: Record<MerchantOrderStatus, readonly MerchantOrderStatus[]> = {
  pending: [],
  processing: ['shipped', 'cancelled'],
  shipped: ['out_for_delivery', 'delivered', 'cancelled'],
  out_for_delivery: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

// Backend PHOTO_MOVES: ship (packing photo), deliver (drop-off photo) and cancel from
// out_for_delivery (failed drop-off photo).
const PHOTO_MOVES: readonly string[] = [
  'processing>shipped',
  'shipped>delivered',
  'out_for_delivery>delivered',
  'out_for_delivery>cancelled',
];

/** The status changes the web lets a farm make from `status`, and no other. */
export function nextStatuses(status: string): MerchantOrderStatus[] {
  return [...(MERCHANT_TRANSITIONS[status as MerchantOrderStatus] ?? [])];
}

/** Whether the move from `from` to `to` needs a proof photo (the status PATCH refuses it). */
export function needsPhoto(from: string, to: string): boolean {
  return PHOTO_MOVES.includes(`${from}>${to}`);
}

/** Order ids in `ids` that have no packing photo yet: a route refuses them (409). */
export function missingPackingPhotos(
  orders: readonly { id: number; packing_photo?: boolean }[],
  ids: readonly number[],
): number[] {
  const packed = new Set(orders.filter((o) => o.packing_photo).map((o) => o.id));
  return ids.filter((id) => !packed.has(id));
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
