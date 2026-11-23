// Merchant copy of mobile/CarabaoMobile/src/lib/orderDetail.ts - only the helpers the
// order chat uses. CF-0114: route values can come from a deep link: checked before use.
// Pure, for `npm test`.

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
