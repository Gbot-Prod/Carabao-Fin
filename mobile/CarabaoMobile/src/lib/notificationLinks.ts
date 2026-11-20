// CF-0105: notification links are web paths (backend services/notifications.py);
// map each to the app screen that does the same job. Pure, for `npm test`.
import { parseOrderId } from './orderDetail.ts';

export type AppRoute =
  | { pathname: '/(tabs)/track' | '/(tabs)/history' | '/merchant-orders' | '/merchant-reviews' | '/merchant-chats' }
  | { pathname: '/order-detail'; params: { orderId: string } }
  | { pathname: '/order-chat'; params: { orderId: string } };

/** The order a chat notification is about: "/chats?order=12", "/merchantDashboard?order=12", or (older) "/orders/12". */
function chatOrderId(link: string): number | null {
  const [path, rest = ''] = link.split('?');
  const query = rest.split('#')[0];
  const fromQuery = /(?:^|&)order=([^&]*)/.exec(query)?.[1];
  if (fromQuery !== undefined && (path === '/chats' || path.startsWith('/merchantDashboard'))) return parseOrderId(fromQuery);
  const m = /^\/orders\/([^/]+)\/?$/.exec(path);
  return m ? parseOrderId(m[1]) : null;
}

// CF-0121 (M50): every merchant notification links to /merchantDashboard; the kind
// says which merchant screen matches (backend services/notifications.py kinds).
export function appRoute(link: string | null, kind?: string): AppRoute | null {
  if (!link) return null;
  const path = link.split(/[?#]/)[0];
  // A chat message opens its chat. Farm questions (no order) have no app
  // screen for buyers; farms see them in their chat list.
  if (kind === 'chat_message') {
    const orderId = chatOrderId(link);
    if (orderId !== null) return { pathname: '/order-chat', params: { orderId: String(orderId) } };
    if (path.startsWith('/merchantDashboard')) return { pathname: '/merchant-chats' };
  }
  if (path.startsWith('/track')) return { pathname: '/(tabs)/track' };
  // "/orders/42" opens that order; the id is checked before it is used.
  const m = /^\/orders\/([^/]+)\/?$/.exec(path);
  if (m) {
    const id = parseOrderId(m[1]);
    return id === null ? { pathname: '/(tabs)/history' } : { pathname: '/order-detail', params: { orderId: String(id) } };
  }
  if (path === '/orders' || path.startsWith('/orders/')) return { pathname: '/(tabs)/history' };
  if (path.startsWith('/merchantDashboard')) {
    return kind === 'review_received' ? { pathname: '/merchant-reviews' } : { pathname: '/merchant-orders' };
  }
  return null;
}
