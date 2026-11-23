// src/lib/badges.ts
// S3 (plan §4): the counts the tab bar and the More menu show. The web MerchantShell.tsx
// draws the same four (Orders, Chats, Shipments row, Produce); the status sets live in
// its MerchantContext.tsx and hooks/useMerchantOrders.ts, and inStep.test.ts keeps this
// file in step with them. Pure (type-only imports), for `npm test`.
import type { ApiMerchantOrder, MerchantOrderStatus } from './api.ts';
import type { ChatSummary } from './chatInbox.ts';

// Same statuses as ACTIVE_STATUSES in M/MerchantContext.tsx and ACTIVE_ORDER_STATUSES
// in backend/app/services/order_status.py.
export const ACTIVE_ORDER_STATUSES: ReadonlySet<MerchantOrderStatus> =
  new Set<MerchantOrderStatus>(['pending', 'processing', 'shipped', 'out_for_delivery']);

// Ready to ship: paid and confirmed, and not already on a route. Same as
// SHIPPABLE_ORDER_STATUSES in backend/app/api/routes/shipments.py and isReadyToShip in
// M/hooks/useMerchantOrders.ts.
export const READY_TO_SHIP_STATUS: MerchantOrderStatus = 'processing';

/** Orders tab: the orders still being worked on (web MerchantShell "Orders" count). */
export function activeOrderCount(orders: readonly Pick<ApiMerchantOrder, 'status'>[]): number {
  return orders.filter((o) => ACTIVE_ORDER_STATUSES.has(o.status)).length;
}

/** Shipments row: orders waiting for a route (web MerchantShell "Shipments" count). */
export function readyToShipCount(
  orders: readonly Pick<ApiMerchantOrder, 'status' | 'shipped' | 'shipment_id'>[],
): number {
  return orders.filter(
    (o) => o.status === READY_TO_SHIP_STATUS && !o.shipped && o.shipment_id == null,
  ).length;
}

/**
 * Chats tab: chats with at least one unread message (web MerchantShell "Chats" count).
 * The web counts chats, not messages; `totalUnread` (chatInbox.ts) sums the messages and
 * is what a chat row shows. The web's count also adds unread inquiries (useMerchantChats
 * unreadCount); S5 adds those to this app, and `chats` here is the order chats only.
 */
export function unreadChatCount(chats: readonly Pick<ChatSummary, 'unread'>[]): number {
  return chats.filter((c) => c.unread > 0).length;
}

/** Produce tab: the farm's listings, expired and hidden ones included (myProduce). */
export function productCount(produce: readonly unknown[]): number {
  return produce.length;
}
