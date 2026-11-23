// Merchant copy of mobile/CarabaoMobile/src/lib/notificationLinks.ts (S12, plan §4.5): it keeps
// only the farm's links, which the buyer app cannot open. Not part of the shared-copy check.
// CF-0105: notification links are web paths (backend services/notifications.py);
// map each to the app screen that does the same job. Pure, for `npm test`.
import { parseOrderId } from './orderChat.ts';

// The merchant app has no `/track` and no order-detail screen (plan §4.2): a farm reads an
// order in the Orders tab and chats in `/order-chat`.
export type AppRoute =
  | { pathname: '/(tabs)' | '/(tabs)/orders' | '/(tabs)/chats' | '/reviews' }
  | { pathname: '/order-chat'; params: { orderId: string } };

/** The order a chat notification is about: "/merchantDashboard?order=12", else null. */
function chatOrderId(link: string): number | null {
  const [path, rest = ''] = link.split('?');
  // The same test as isMerchantNotification, so every merchant link is read the same way.
  if (!path.startsWith('/merchantDashboard')) return null;
  const query = rest.split('#')[0];
  const fromQuery = /(?:^|&)order=([^&]*)/.exec(query)?.[1];
  return fromQuery === undefined ? null : parseOrderId(fromQuery);
}

/**
 * Whether a notification belongs to the farm (plan §4.5): the backend stores
 * `/merchantDashboard` for every merchant notification (SUBDOMAINS.md 1.5). The merchant
 * account can also have buyer notifications (`/orders/12`, `/track`, ...); those stay in the
 * buyer app, so the merchant list filters them out. Pure, for `npm test`.
 */
export function isMerchantNotification(link: string | null): boolean {
  return !!link && link.split(/[?#]/)[0].startsWith('/merchantDashboard');
}

// CF-0121 (M50): every merchant notification links to /merchantDashboard; the kind says
// which merchant screen matches (backend services/notifications.py kinds). The web bell
// opens the same page per kind (SUBDOMAINS.md 1.5), and the buyer app hands these over.
export function appRoute(link: string | null, kind?: string): AppRoute | null {
  // A buyer link is the buyer app's: this app opens nothing for it.
  if (!link || !isMerchantNotification(link)) return null;
  // A chat message opens its chat. A farm question (no order) has no chat to open, so the
  // chat list shows; the id is checked before it is used.
  if (kind === 'chat_message') {
    const orderId = chatOrderId(link);
    return orderId === null
      ? { pathname: '/(tabs)/chats' }
      : { pathname: '/order-chat', params: { orderId: String(orderId) } };
  }
  if (kind === 'new_order') return { pathname: '/(tabs)/orders' };
  if (kind === 'review_received') return { pathname: '/reviews' };
  // payout_released and payout_destination_changed: Earnings is Plan 2, so the dashboard for
  // now (the web bell opens /earnings). Every other kind opens the dashboard too.
  return { pathname: '/(tabs)' };
}
