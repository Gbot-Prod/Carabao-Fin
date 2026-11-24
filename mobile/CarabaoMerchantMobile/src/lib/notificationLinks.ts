// Merchant copy of mobile/CarabaoMobile/src/lib/notificationLinks.ts (S12, plan §4.5): it keeps
// only the farm's links, which the buyer app cannot open. Not part of the shared-copy check.
// CF-0105: notification links are web paths (backend services/notifications.py);
// map each to the app screen that does the same job. Pure, for `npm test`.
import { parseOrderId } from './orderChat.ts';

// The merchant app has no `/track` and no order-detail screen (plan §4.2): a farm reads an
// order in the Orders tab and chats in `/order-chat`.
export type AppRoute =
  | { pathname: '/(tabs)' | '/(tabs)/chats' | '/(tabs)/produce' | '/reviews' | '/earnings' }
  // S4 (plan §5.2): the Orders tab opens this order's detail sheet.
  | { pathname: '/(tabs)/orders'; params?: { order: string } }
  | { pathname: '/order-chat'; params: { orderId: string } }
  // S5: a buyer's question about the farm, which has no order (conversation id).
  | { pathname: '/order-chat'; params: { inquiry: string } };

/**
 * The id in a merchant link's query: "/merchantDashboard?order=12" → 12, else null. The
 * backend writes both `?order=` (an order chat) and `?inquiry=` (a farm question, S5).
 */
function linkId(link: string, key: 'order' | 'inquiry'): number | null {
  const [path, rest = ''] = link.split('?');
  // The same test as isMerchantNotification, so every merchant link is read the same way.
  if (!path.startsWith('/merchantDashboard')) return null;
  const query = rest.split('#')[0];
  const fromQuery = new RegExp(`(?:^|&)${key}=([^&]*)`).exec(query)?.[1];
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
  // A chat message opens its chat. S5: a farm question (no order) opens its own chat, as
  // the web's `/merchant/chats?inquiry=` does; an id is checked before it is used. Without
  // either id the chat list shows.
  if (kind === 'chat_message') {
    const orderId = linkId(link, 'order');
    if (orderId !== null) return { pathname: '/order-chat', params: { orderId: String(orderId) } };
    const conversationId = linkId(link, 'inquiry');
    return conversationId === null
      ? { pathname: '/(tabs)/chats' }
      : { pathname: '/order-chat', params: { inquiry: String(conversationId) } };
  }
  // S4 (plan §5.2): a new order with an id opens that order's sheet, not just the tab.
  if (kind === 'new_order') {
    const orderId = linkId(link, 'order');
    return orderId === null
      ? { pathname: '/(tabs)/orders' }
      : { pathname: '/(tabs)/orders', params: { order: String(orderId) } };
  }
  if (kind === 'review_received') return { pathname: '/reviews' };
  // Guardrails Phase 1: an admin approved or rejected a listing (web: /produce).
  // Phase 2: penalty points (listing_blocked, listing_penalty_revoked) open the same tab.
  if (kind?.startsWith('listing_')) return { pathname: '/(tabs)/produce' };
  // S3 (plan §4): the web bell opens /earnings for both payout kinds, so this app does too.
  if (kind === 'payout_released' || kind === 'payout_destination_changed') {
    return { pathname: '/earnings' };
  }
  // Every other kind opens the dashboard.
  return { pathname: '/(tabs)' };
}
