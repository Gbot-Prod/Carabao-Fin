// CF-0105: rules for the buyer's order detail screen. Pure, for `npm test`.
// The server enforces every rule again; these only decide which buttons to show.

/** What the buyer can do with an order in this status (same as web orders/[orderId]). */
export function orderActions(status: string): {
  canCancel: boolean; canCancelUnpaid: boolean; canTrack: boolean;
} {
  return {
    // CF-0124: an unpaid order (backend POST /payments/checkout/{id}/cancel; refused
    // with 409 once paid or while a payment is in progress).
    canCancelUnpaid: status === 'pending',
    // backend cancel_my_order: only `processing` (paid, not shipped yet).
    canCancel: status === 'processing',
    // web: live tracking for open orders that are paid.
    canTrack: status === 'processing' || status === 'shipped' || status === 'out_for_delivery',
  };
}

/** "CB-2026-0042", the same form as backend notifications.order_ref. */
export function orderRef(orderId: number, orderedAt: string | null | undefined): string {
  const year = orderedAt && /^\d{4}/.test(orderedAt) ? orderedAt.slice(0, 4) : 'XXXX';
  return `CB-${year}-${String(orderId).padStart(4, '0')}`;
}

/** True for a reference in the backend's form ("CB-2026-0042"); route values are checked with it. */
export function isOrderRef(value: unknown): value is string {
  return typeof value === 'string' && /^CB-(\d{4}|XXXX)-\d{4,10}$/.test(value);
}

/**
 * The chat screen's header. The app passes "Chat with <farm>"; any other value from a
 * route (a deep link can set it) is replaced, so a link cannot make an order chat look
 * like "Carabao support" or carry a message. CF-0114.
 */
export function chatTitle(raw: string | string[] | undefined, isSupport: boolean, orderId: number | null): string {
  if (isSupport) return 'Carabao support';
  if (typeof raw === 'string' && /^Chat with [^\n\r]{1,80}$/.test(raw) && !/support/i.test(raw)) return raw;
  return orderId === null ? 'Order chat' : `Order #${orderId}`;
}

/**
 * The order ID from a route or deep-link parameter, or null. Only a plain positive
 * whole number is accepted, so "1e3", "0x10", " 7", "7/../x" or arrays never reach a URL.
 */
export function parseOrderId(raw: string | string[] | undefined): number | null {
  if (typeof raw !== 'string' || !/^[1-9]\d{0,9}$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

/** CF-0128 (M62): same text as the web order page for a review an admin hid (CF-0078). */
export const HIDDEN_REVIEW_NOTICE =
  'After a check by Carabao, this review is not shown on the farm page and does not count in its rating. ' +
  'Contact support if you think this is a mistake.';

/**
 * ORDER_PROOF_PHOTOS_PLAN.md: what the "Delivery photos" card says for a delivery the farm
 * marked with a drop-off photo, or null for any other order. Same order of checks as web
 * orders/[orderId] DeliveryProofSection; the server checks the dispute again.
 */
export type DeliveryProofState = 'refund' | 'release' | 'disputed' | 'confirmed' | 'open' | 'closed';

export function deliveryProofState(order: {
  status: string;
  delivery_confirmed_by: string | null;
  can_dispute?: boolean;
  delivery_buyer_confirmed_at?: string | null;
  delivery_disputed_at?: string | null;
  dispute_resolution?: string | null;
}): DeliveryProofState | null {
  if (order.status !== 'delivered' || order.delivery_confirmed_by !== 'merchant') return null;
  if (order.dispute_resolution === 'refund') return 'refund';
  if (order.dispute_resolution === 'release') return 'release';
  if (order.delivery_disputed_at) return 'disputed';
  if (order.delivery_buyer_confirmed_at) return 'confirmed';
  return order.can_dispute ? 'open' : 'closed';
}
