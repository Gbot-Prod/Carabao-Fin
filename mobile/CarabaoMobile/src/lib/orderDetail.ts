// CF-0105: rules for the buyer's order detail screen. Pure, for `npm test`.
// The server enforces every rule again; these only decide which buttons to show.

/** What the buyer can do with an order in this status (same as web orders/[orderId]). */
export function orderActions(status: string): { canCancel: boolean; canConfirm: boolean; canTrack: boolean } {
  return {
    // backend cancel_my_order: only `processing` (paid, not shipped yet).
    canCancel: status === 'processing',
    // backend confirm_order_received: IN_TRANSIT_STATUSES.
    canConfirm: status === 'shipped' || status === 'out_for_delivery',
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
