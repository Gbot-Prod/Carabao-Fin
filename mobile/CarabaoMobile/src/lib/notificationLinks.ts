// CF-0105: notification links are web paths (backend services/notifications.py);
// map each to the app screen that does the same job. Pure, for `npm test`.
import { parseOrderId } from './orderDetail.ts';

export type AppRoute =
  | { pathname: '/(tabs)/track' | '/(tabs)/history' | '/merchant-orders' | '/merchant-reviews' }
  | { pathname: '/order-detail'; params: { orderId: string } };

// CF-0121 (M50): every merchant notification links to /merchantDashboard; the kind
// says which merchant screen matches (backend services/notifications.py kinds).
export function appRoute(link: string | null, kind?: string): AppRoute | null {
  if (!link) return null;
  const path = link.split(/[?#]/)[0];
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
