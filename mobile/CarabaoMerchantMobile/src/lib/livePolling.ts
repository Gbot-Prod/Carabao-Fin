// Shared with mobile/CarabaoMobile/src/lib/livePolling.ts. Keep both copies the same (sharedCopies.test.ts).
// CF-0134: when the track screen and a chat keep asking the server. Pure, for `npm test`.
import { CLOSED_ORDER_STATUSES } from './orderStatus.ts';

/** Same as the web track page (`app/(site)/(app)/track/page.tsx` POLL_MS). */
export const TRACKING_POLL_MS = 30_000;

/**
 * Refresh the ETA only for a shipped order that is not finished. Before shipping
 * there is no route; after delivery or cancel the answer can no longer change
 * (web `isRouteFinished`). The order's own status comes from the newest tracking
 * answer when there is one, else from the order list.
 */
export function shouldRefreshTracking(
  order: { shipped: boolean; status: string } | undefined,
  tracking: { status: string } | null,
): boolean {
  if (!order || !order.shipped) return false;
  const status = tracking?.status ?? order.status;
  return !(CLOSED_ORDER_STATUSES as readonly string[]).includes(status);
}

/**
 * A chat polls until the server says the thread is closed (7 days after
 * delivery); a closed thread gets no new messages. Support chats never close.
 */
export function shouldPollChat(hasThread: boolean, closed: boolean): boolean {
  return hasThread && !closed;
}
