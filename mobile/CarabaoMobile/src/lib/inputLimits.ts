// CF-0126: the same input bounds as the backend for free-text fields the app sends
// (MASVS "input": the server checks again, the app stops the user early), and a
// cleaner for text that arrives in a route parameter (a deep link can set it).
// Pure, for `npm test`; inStep checks the numbers against the backend files.

export const CHAT_BODY_MAX = 2000; // backend services/chat.py MAX_BODY
export const ORDER_NOTES_MAX = 500; // backend schemas/order.py PlaceOrderRequest.notes
export const DELIVERY_ADDRESS_MAX = 500; // PlaceOrderRequest.delivery_address

/**
 * A short, single-line text from a route, or null. Control characters and line
 * breaks are refused (not stripped) so a link cannot lay out a fake message.
 */
export function routeText(raw: string | string[] | undefined, max = 100): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v || v.length > max) return null;
  if (/[\u0000-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(v)) return null;
  return v;
}
