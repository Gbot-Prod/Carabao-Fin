// src/lib/badges.ts
// S3 (plan §4): the counts the tab bar and the More menu show. The web MerchantShell.tsx
// draws the same four (Orders, Chats, Shipments row, Produce); the status sets live in
// its MerchantContext.tsx and hooks/useMerchantOrders.ts, and inStep.test.ts keeps this
// file in step with them. Pure (type-only imports), for `npm test`.
import type { ApiMerchantOrder, MerchantOrderStatus } from './api.ts';
import type { ChatSummary, InquirySummary } from './chatInbox.ts';
import { readyToShipOrders, READY_TO_SHIP_STATUS } from './shipments.ts';

// Ready to ship is the one rule the Shipments screen (S11) shares, so it lives in
// src/lib/shipments.ts (same as SHIPPABLE_ORDER_STATUSES in
// backend/app/api/routes/shipments.py and isReadyToShip in M/hooks/useMerchantOrders.ts)
// and is re-exported here for the counts below.
export { READY_TO_SHIP_STATUS };

// Same statuses as ACTIVE_STATUSES in M/MerchantContext.tsx and ACTIVE_ORDER_STATUSES
// in backend/app/services/order_status.py.
export const ACTIVE_ORDER_STATUSES: ReadonlySet<MerchantOrderStatus> =
  new Set<MerchantOrderStatus>(['pending', 'processing', 'shipped', 'out_for_delivery']);

/** Orders tab: the orders still being worked on (web MerchantShell "Orders" count). */
export function activeOrderCount(orders: readonly Pick<ApiMerchantOrder, 'status'>[]): number {
  return orders.filter((o) => ACTIVE_ORDER_STATUSES.has(o.status)).length;
}

/** Shipments row: orders waiting for a route (web MerchantShell "Shipments" count). */
export function readyToShipCount(
  orders: readonly Pick<ApiMerchantOrder, 'status' | 'shipped' | 'shipment_id'>[],
): number {
  return readyToShipOrders(orders).length;
}

/**
 * Chats tab: rows with at least one unread message (web MerchantShell "Chats" count).
 * The web adds the order chats and the pre-order inquiries (useMerchantChats unreadCount),
 * and counts rows, not messages; `totalUnread` (chatInbox.ts) sums the messages and is
 * what a chat row shows. S5.
 */
export function unreadChatCount(
  chats: readonly Pick<ChatSummary, 'unread'>[],
  inquiries: readonly Pick<InquirySummary, 'unread'>[] = [],
): number {
  return chats.filter((c) => c.unread > 0).length + inquiries.filter((c) => c.unread > 0).length;
}

/** Produce tab: the farm's listings, expired and hidden ones included (myProduce). */
export function productCount(produce: readonly unknown[]): number {
  return produce.length;
}
