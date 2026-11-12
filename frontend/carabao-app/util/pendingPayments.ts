import type { PlacedOrder } from '@/util/api/orders';

// Orders from one multi-merchant checkout (C1) that still need paying. PayMongo
// takes one order per checkout session, so the buyer pays them in turn; this
// per-tab list lets the success page offer the next one. Unpaid orders expire on
// the server regardless, so losing this list never leaves stock held.

const KEY = 'carabao.pendingPayments';

export function savePendingPayments(orders: PlacedOrder[]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(orders));
  } catch {
    // Private mode or storage blocked: the buyer can still pay from Orders.
  }
}

export function loadPendingPayments(): PlacedOrder[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as PlacedOrder[]) : [];
  } catch {
    return [];
  }
}

/** Drops ``orderId`` from the list and returns what is left. */
export function removePendingPayment(orderId: number): PlacedOrder[] {
  const rest = loadPendingPayments().filter((o) => o.order_id !== orderId);
  if (rest.length) savePendingPayments(rest);
  else clearPendingPayments();
  return rest;
}

export function clearPendingPayments(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
