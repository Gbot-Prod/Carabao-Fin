// CF-0105: notification links are web paths (backend services/notifications.py);
// map each to the app screen that does the same job. Pure, for `npm test`.
import { parseOrderId } from './orderDetail.ts';

export type AppRoute =
  | { pathname: '/(tabs)/track' | '/(tabs)/history' }
  | { pathname: '/order-detail'; params: { orderId: string } }
  | { pathname: '/order-chat'; params: { orderId: string } }
  // CF-0125 / CF-0127: merchant work is Carabao Merchant's, so the buyer app hands these
  // over (src/lib/openMerchant.ts) instead of opening a screen of its own. `orderId` is
  // set only for a chat message about one checked order, so the merchant app opens that chat.
  | { merchant: string | undefined; orderId?: number };

/** The order a chat notification is about: "/chats?order=12" or (older) "/orders/12". */
function chatOrderId(link: string): number | null {
  const [path, rest = ''] = link.split('?');
  const query = rest.split('#')[0];
  const fromQuery = /(?:^|&)order=([^&]*)/.exec(query)?.[1];
  if (fromQuery !== undefined && path === '/chats') return parseOrderId(fromQuery);
  const m = /^\/orders\/([^/]+)\/?$/.exec(path);
  return m ? parseOrderId(m[1]) : null;
}

/** The order in a merchant link ("/merchantDashboard?order=12"), checked, else null. */
function merchantOrderId(link: string): number | null {
  const query = (link.split('?')[1] ?? '').split('#')[0];
  const raw = /(?:^|&)order=([^&]*)/.exec(query)?.[1];
  return raw === undefined ? null : parseOrderId(raw);
}

// CF-0121 (M50): every merchant notification links to /merchantDashboard; the kind
// says which merchant screen matches (backend services/notifications.py kinds). The
// merchant app reads the same kind (src/lib/notificationLinks.ts there).
export function appRoute(link: string | null, kind?: string): AppRoute | null {
  if (!link) return null;
  const path = link.split(/[?#]/)[0];
  // Merchant links: the whole dashboard, and the chat message for one of its orders
  // ("/merchantDashboard?order=12"), belong to the merchant app - buyers never see them.
  if (path.startsWith('/merchantDashboard')) {
    const orderId = kind === 'chat_message' ? merchantOrderId(link) : null;
    return orderId === null ? { merchant: kind } : { merchant: kind, orderId };
  }
  // A chat message opens its chat. Farm questions (no order) have no app screen for
  // buyers; farms see them in their chat list, in the merchant app.
  if (kind === 'chat_message') {
    const orderId = chatOrderId(link);
    if (orderId !== null) return { pathname: '/order-chat', params: { orderId: String(orderId) } };
  }
  if (path.startsWith('/track')) return { pathname: '/(tabs)/track' };
  // "/orders/42" opens that order; the id is checked before it is used.
  const m = /^\/orders\/([^/]+)\/?$/.exec(path);
  if (m) {
    const id = parseOrderId(m[1]);
    return id === null ? { pathname: '/(tabs)/history' } : { pathname: '/order-detail', params: { orderId: String(id) } };
  }
  if (path === '/orders' || path.startsWith('/orders/')) return { pathname: '/(tabs)/history' };
  return null;
}
